import { renderMarkdown } from '@flisk-sh/md2html';
import { describe, expect, it } from 'vitest';
import { localizeLinks, pageHref } from '../src/links';

const ref = { owner: 'flisk-sh', repo: 'flisk' };
const pages = new Set(['docs/ci.md', 'docs/start/words.md', 'docs/install/README.md', 'docs/a b.md']);
const known = (p: string) => pages.has(p);
const render = (md: string) => renderMarkdown(md, { baseUrl: 'https://github.com/flisk-sh/flisk/blob/abc123/docs/quickstart.md', headingIds: false });

describe('pageHref', () => {
  it('is the page, with its heading after a second #', () => {
    expect(pageHref('docs/ci.md')).toBe('#page=docs%2Fci.md');
    expect(pageHref('docs/ci.md', 'the-workflow')).toBe('#page=docs%2Fci.md%23the-workflow');
  });
});

describe('localizeLinks', () => {
  it('keeps links to pages of the help center inside it, with their heading', () => {
    const html = localizeLinks(render('See [CI](ci.md) and [Node](start/words.md#nodejs).'), ref, known);
    expect(html).toContain('<a href="#page=docs%2Fci.md" data-page="docs/ci.md">CI</a>');
    expect(html).toContain('href="#page=docs%2Fstart%2Fwords.md%23nodejs" data-page="docs/start/words.md" data-anchor="nodejs"');
    expect(html).not.toContain('target="_blank"');
  });

  it('reads absolute links at any branch, encoded paths, and folders as their README', () => {
    const html = localizeLinks(
      render('[abs](https://github.com/Flisk-sh/Flisk/blob/main/docs/ci.md) [dir](install/) [space](a%20b.md)'),
      ref,
      known,
    );
    expect(html).toContain('data-page="docs/ci.md"');
    expect(html).toContain('data-page="docs/install/README.md"');
    expect(html).toContain('data-page="docs/a b.md"');
  });

  it('leaves other links alone: code, pages left out, other repositories, the web, anchors', () => {
    const md = '[code](../cli/src/index.ts) [gone](drafts/x.md) [other](https://github.com/vercel/next.js/blob/main/docs/a.md) [web](https://example.com) [here](#pick-a-path)';
    const before = render(md);
    expect(localizeLinks(before, ref, known)).toBe(before);
  });
});
