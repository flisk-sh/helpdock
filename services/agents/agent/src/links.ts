// Links between pages stay inside the help center. md2html resolves a relative link ("start/words.md#node") against
// the page's file on GitHub, so without this every link in a page sent the reader to github.com after one click.

import type { RepoRef } from './github';

/** The help center's own address of a page, below its base path: #page=docs%2Fci.md, with a heading anchor. */
export function pageHref(source: string, anchor = ''): string {
  return `#page=${encodeURIComponent(anchor ? `${source}#${anchor}` : source)}`;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Rewrites links to pages of this repository (github.com/<owner>/<repo>/blob/<any ref>/<path>) into links to the
 * same page here, when `known(path)` says the page is in the help center. A link to a folder opens its README or
 * index page. Other links (other repositories, code files, pages left out) are left as they are.
 */
export function localizeLinks(html: string, ref: Pick<RepoRef, 'owner' | 'repo'>, known: (path: string) => boolean): string {
  const prefix = `https://github.com/${ref.owner}/${ref.repo}/blob/`.toLowerCase();
  return html.replace(/<a\s([^>]*?)href="([^"]*)"([^>]*)>/g, (tag, before: string, href: string, after: string) => {
    const raw = href.replace(/&amp;/g, '&');
    if (!raw.toLowerCase().startsWith(prefix)) return tag;
    const rest = raw.slice(prefix.length); // <ref>/<path>[?query][#anchor]
    const slash = rest.indexOf('/');
    if (slash < 0) return tag;
    const hash = rest.indexOf('#', slash);
    const anchor = hash >= 0 ? decode(rest.slice(hash + 1)) : '';
    const path = decode(rest.slice(slash + 1, hash >= 0 ? hash : undefined).replace(/\?.*$/, ''));
    let target: string | null = null;
    if (path && !path.endsWith('/') && known(path)) target = path;
    else {
      const dir = path.replace(/\/?$/, '/');
      target = ['README.md', 'readme.md', 'index.md', 'index.mdx', 'README.mdx'].map((n) => `${dir === '/' ? '' : dir}${n}`).find(known) ?? null;
    }
    if (!target) return tag;
    const attrs = `${before}${after}`.replace(/\s*\b(target|rel)="[^"]*"/g, '').trim();
    const local = pageHref(target, anchor).replace(/&/g, '&amp;');
    const data = `data-page="${target.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"${anchor ? ` data-anchor="${anchor.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : ''}`;
    return `<a ${attrs ? `${attrs} ` : ''}href="${local}" ${data}>`;
  });
}
