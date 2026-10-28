// Reading a public GitHub repository's Markdown, three ways, first that works:
//   readRepoViaGit       git's own protocol, no REST API and no token: a partial clone of the default branch at depth 1
//                        with no file contents (--filter=blob:none), then a sparse checkout of *.md and *.mdx, so git
//                        downloads the file tree and the docs only (Next.js: 1,335 docs, 9 MB, about 4 s). It runs in
//                        its own process, so the server keeps answering while it works.
//   readRepoViaApi       GitHub's git trees API and raw.githubusercontent.com. Unauthenticated it allows 60 calls an
//                        hour per address, and a host's address is often shared.
//   readRepoMarkdown     GitHub's archive download (codeload.github.com), gunzipped and untarred as it streams,
//                        keeping only documentation. Works for any public repository, slowly for big ones.
// Tried and dropped: jsDelivr's mirror (branch listings months old) and ungh.cc (rate limited by address, like the
// API). Every way stops at fixed limits so a huge repository cannot exhaust a small instance, and the repository
// name is validated, so a request can never make the server fetch an address of its choosing.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createGunzip } from 'node:zlib';
import { isRstPath, rstToMarkdown } from './rst';
import { TarStream } from './tar';

export interface RepoRef {
  owner: string;
  repo: string;
  /** A folder of the repository, without slashes at either end ("content/terraform/v1.17.x/docs"); empty for all of it. */
  scope?: string;
  /** The branch named in a GitHub tree URL, kept so the page's own URL can be rebuilt; data is read at HEAD. */
  branch?: string;
}

/** Whether `path` is inside the scope folder (everything is, without a scope). */
export const inScope = (path: string, scope?: string) => !scope || path.startsWith(`${scope}/`);

/** The path of a repository's help center on this site: /owner/repo/, or /owner/repo/tree/<branch>/<scope>/. */
export function repoBase(ref: RepoRef): string {
  return `/${ref.owner}/${ref.repo}/${ref.scope ? `tree/${ref.branch || 'main'}/${ref.scope}/` : ''}`;
}

export interface RepoFile {
  path: string; // inside the repository, e.g. docs/guide.md
  text: string;
}

export interface RepoRead {
  files: RepoFile[];
  sha: string | null;
  /** True when a limit stopped the read before the end of the archive. */
  truncated: boolean;
  /** Uncompressed archive bytes read. */
  archiveBytes: number;
}

export interface ReadLimits {
  /** Uncompressed archive bytes to read at most (the whole repository streams through, not only its docs). */
  maxArchiveBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  timeoutMs: number;
}

export const DEFAULT_LIMITS: ReadLimits = {
  maxArchiveBytes: 400 * 1024 * 1024,
  maxFiles: 600,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  // GitHub builds archives of very large repositories slowly; index what has arrived by then.
  timeoutMs: 25_000,
};

/**
 * Process memory (RSS) at which an archive read stops and keeps what it has. Bun's fetch reads the network ahead of a
 * slow consumer, so on a small instance (Render free: 512 MB, 0.1 CPU) a large archive piled up until the process was
 * killed. HELPDOCK_MEMORY_MB sets it (default 300).
 */
export const MEMORY_LIMIT_MB = Number(process.env.HELPDOCK_MEMORY_MB || 300);
export const rssMb = () => process.memoryUsage().rss / 1024 / 1024;

// Candidates read before choosing: more than the limits, so the best files can be kept (see docPriority).
const CANDIDATE_FACTOR = 3;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
// First path segments the app itself uses, so /mcp/x or /assets/x is never read as a repository.
const RESERVED = new Set(['health', 'ready', 'turn', 'search', 'docs', 'session', 'mcp', 'status', 'pages', 'page', 'api', 'assets', 'static', 'favicon.ico', 'robots.txt', 'github', 'sitemap.xml', 'llms.txt']);

/**
 * `/owner/repo[/rest]` → the repository and the rest of the path. Also accepts what people paste after replacing
 * github.com: `/owner/repo/tree/main/docs` or `/owner/repo.git`. Null for anything else.
 */
// The routes below a help center; a scope folder named like one of them is read as the route (not "docs": that is a
// route of the deployment's own docs only, and many repositories have a docs folder).
const ROUTES = new Set(['status', 'pages', 'page', 'lead', 'search', 'turn', 'session', 'mcp', 'readme', 'warm']);

export function parseRepoPath(pathname: string): (RepoRef & { rest: string }) | null {
  const m = /^\/([^/]+)\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, '');
  if (RESERVED.has(owner.toLowerCase()) || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
    return null;
  }
  let rest = m[3] ?? '';
  // A GitHub tree URL (/tree/<branch>/<folder>) scopes the help center to that folder.
  const tree = /^\/tree\/([^/]+)\/(.+?)\/?$/.exec(rest);
  if (tree) {
    let segments: string[];
    try {
      segments = tree[2].split('/').map(decodeURIComponent);
    } catch {
      return null;
    }
    let route = '';
    if (segments.length > 1 && ROUTES.has(segments[segments.length - 1])) route = `/${segments.pop()}`;
    else if (segments.length === 1 && ROUTES.has(segments[0])) return { owner, repo, rest: `/${segments[0]}` };
    if (segments.some((s) => !s || s === '.' || s === '..' || /[\0\\/]/.test(s)) || segments.join('/').length > 200) return null;
    return { owner, repo, rest: route, scope: segments.join('/'), branch: decodeURIComponent(tree[1]) };
  }
  // Other GitHub paths below a repository (blob/wiki/issues/...) all mean "this repository" here.
  if (/^\/(tree|blob|wiki|issues|pulls|discussions|releases)(\/|$)/.test(rest)) rest = '';
  return { owner, repo, rest };
}

/** Whether a path is documentation worth indexing. */
/** What git reads for a repository: Markdown, MDX and reStructuredText everywhere, or just the scope folder. */
export function sparsePatterns(scope?: string): string[] {
  if (scope) return [`/${scope}/`];
  return ['*.md', '*.mdx', '*.markdown', '*.rst', '/docs/**/*.txt', '/doc/**/*.txt'];
}

export function isDocPath(path: string): boolean {
  if (!/\.(md|mdx|markdown|rst)$/i.test(path) && !isRstPath(path)) return false;
  const lower = path.toLowerCase();
  // Hidden folders (.github, .claude, agent worktrees) hold tooling, templates and copies, not documentation.
  if (/(^|\/)\.[^/]+\//.test(lower)) return false;
  if (/(^|\/)(node_modules|vendor|third_party|dist|build|target|fixtures?|__snapshots__|testdata)\//.test(lower)) {
    return false;
  }
  // A folder of release notes (Django: docs/releases, over 300 files) answers questions about the past, and would fill
  // the page limit before the how-to pages.
  if (/(^|\/)(releases?|release-notes|changelogs?)\//.test(lower)) return false;
  // Translations: docs/de/..., i18n/ja/... are skipped; English is what the index and its stop words are for.
  if (/(^|\/)(docs|i18n|translations|locales?|content|lang)\/(?!en(-[a-z]+)?\/)[a-z]{2}(-[a-z]{2,4})?\//.test(lower)) return false;
  const base = lower.split('/').pop() ?? '';
  // Change logs and legal text match every query and answer none.
  return !/^(changelog|changes|history|license|licence|notice|third[-_]party|code[-_]of[-_]conduct)/.test(base);
}

/**
 * How much a file looks like user documentation, for keeping the best files when a repository has more than the
 * limit: docs folders and the root README first, deep paths and files written for contributors or agents last.
 */
export function docPriority(path: string): number {
  const lower = path.toLowerCase();
  const depth = lower.split('/').length - 1;
  let score = 0;
  const inDocs = /(^|\/)(docs?|documentation|guides?|handbook|manual|website\/content|content\/docs)\//.test(lower);
  if (inDocs) score += 4;
  if (lower === 'readme.md' || lower === 'readme.mdx') score += 6;
  else if (/(^|\/)readme\.mdx?$/.test(lower)) score += 1;
  if (/(^|\/)(agents|claude|gemini|contributing|security|support|pull_request_template|issue_template)[^/]*\.mdx?$/.test(lower)) score -= 4;
  // Folders of prompts, skills and agent instructions are tooling for contributors' coding agents.
  if (/(^|\/)(agents?|prompts?|skills?|\.?claude|copilot)\//.test(lower)) score -= 4;
  // How to contribute to the project is for its maintainers, not for people using it.
  if (/(^|\/)contributing\//.test(lower)) score -= 4;
  // Release notes and a project's own internals (Django: docs/releases, docs/internals) are not how-to either.
  if (/(^|\/)(releases?|release-notes|internals)\//.test(lower)) score -= 4;
  // Marketing copy, outreach, launch notes, blog posts and design records talk about the product; they are not how-to.
  if (/(^|\/)(marketing|outreach|launch|blog|posts|articles|press|rfcs?|adr|decisions|openspec)\//.test(lower)) score -= 3;
  // Example and test folders inside the docs (docs/examples/) are documentation; elsewhere they are code samples.
  if (!inDocs && /(^|\/)(examples?|samples?|tests?|benchmarks?|scripts?)\//.test(lower)) score -= 2;
  return score - Math.max(0, depth - 3);
}

/**
 * Markdown or MDX as plain Markdown for indexing: front matter dropped (its `title` becomes the page heading when the
 * page has none), MDX import/export lines and JSX tags removed, their text kept.
 */
export function normalizeMarkdown(path: string, text: string): string {
  // reStructuredText (Django's docs/*.txt, Sphinx's .rst) becomes Markdown first; the rest of this is for Markdown.
  if (isRstPath(path)) return rstToMarkdown(text);
  let body = text.replace(/\r\n/g, '\n');
  let title: string | null = null;
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(body);
  if (fm) {
    // `title:` (most sites) or `page_title:` (HashiCorp's docs)
    title = /^(?:page_)?title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1])?.[1] ?? null;
    body = body.slice(fm[0].length);
  }
  if (/\.mdx$/i.test(path)) {
    const out: string[] = [];
    let inFence = false;
    for (const line of body.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (!inFence && /^(import|export)\s/.test(line)) continue;
      // HashiCorp's includes ("@include 'file.mdx'") pull in text we do not have.
      if (!inFence && /^@include\s/.test(line)) continue;
      // and its callouts: "-> note", "~> warning", "!> danger", "=> tip" at the start of a paragraph
      if (!inFence && /^(->|~>|!>|=>)\s/.test(line)) {
        out.push(`> ${line.slice(3).trim()}`);
        continue;
      }
      out.push(inFence ? line : line.replace(/<\/?[A-Z][\w.]*(\s[^<>]*)?\/?>/g, ''));
    }
    // MDX comments, {/* ... */}, can span lines.
    body = out.join('\n').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  }
  body = mkdocsToMarkdown(body);
  if (title) {
    // The front matter title is the page's real one (Next.js: "Glossary", over its "# A", "# B" letter headings), so
    // it becomes the only # heading and the body's own # headings move down a level, outside code fences.
    let inFence = false;
    body = body
      .split('\n')
      .map((line) => {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        return !inFence && /^#\s+\S/.test(line) ? `#${line}` : line;
      })
      .join('\n');
    body = `# ${title}\n\n${body}`;
  }
  return body.trim();
}

const HTML_TAGS =
  'a|abbr|b|blockquote|br|center|code|dd|del|details|div|dl|dt|em|figcaption|figure|h[1-6]|hr|i|img|ins|kbd|li|mark|ol|p|picture|pre|q|s|samp|small|source|span|strong|sub|summary|sup|table|tbody|td|tfoot|th|thead|tr|u|ul|video';
const TAG = new RegExp(`<\\/?(?:${HTML_TAGS})(?:\\s[^<>]*)?\\/?>`, 'gi');

/**
 * HTML inside Markdown (README badges, tables of image links, <details>) as text, for the search index and for the
 * text an AI is handed (display keeps the HTML and renders it with md2html): comments dropped, an image becomes
 * its alt text, line breaks and table rows become new lines, cells are separated, other tags go and their text stays.
 * Code (fenced blocks and inline spans) is left alone, so `<App>` in a code span survives.
 */
export function htmlToMarkdown(body: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence || !/<\/?[a-z]/i.test(line)) {
      out.push(line);
      continue;
    }
    const text = line
      .split(/(`[^`]*`)/g)
      .map((part, i) =>
        i % 2 === 1
          ? part
          : part
              .replace(/<img\b[^>]*?\balt="([^"]*)"[^>]*>/gi, (_, alt: string) => (alt ? `${alt} · ` : ''))
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/gi, ' · ')
              .replace(/<\/tr>/gi, '\n')
              .replace(TAG, ''),
      )
      .join('');
    out.push(
      ...text.split('\n').map((l) =>
        l
          .replace(/(\s*·\s*){2,}/g, ' · ')
          .replace(/\s{2,}/g, ' ')
          .replace(/^\s*·\s*|\s*·\s*$/g, '')
          .trimEnd(),
      ),
    );
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * MkDocs Material syntax as plain Markdown, outside code fences: content tabs (=== "pip") become a bold label with
 * the tab body dedented, admonitions (!!! note "Title", ??? tip) become a quoted label, reference links [text][ref]
 * become their text, and snippet includes (--8<--) are dropped.
 */
export function mkdocsToMarkdown(body: string): string {
  const out: string[] = [];
  let inFence = false;
  let indent = 0; // the indentation a tab or admonition body carries
  for (const raw of body.split('\n')) {
    let line = raw;
    if (indent > 0 && line.trim() && !line.startsWith(' '.repeat(indent))) indent = 0;
    if (indent > 0) line = line.slice(Math.min(indent, line.length - line.trimStart().length));
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) {
      out.push(line);
      continue;
    }
    const tab = /^(\s*)===\s+"([^"]*)"\s*$/.exec(line);
    if (tab) {
      out.push(`**${tab[2]}**`);
      indent = tab[1].length + 4;
      continue;
    }
    const adm = /^(\s*)(!!!|\?\?\?\+?)\s+(\w+)(?:\s+"([^"]*)")?\s*$/.exec(line);
    if (adm) {
      const kind = adm[3].charAt(0).toUpperCase() + adm[3].slice(1);
      out.push(`> **${adm[4] || kind}**`);
      indent = adm[1].length + 4;
      continue;
    }
    if (/^\s*--8<--/.test(line)) continue;
    out.push(line.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1'));
  }
  return out.join('\n');
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to dashes. */
export function githubAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

export function fileUrl(ref: RepoRef, sha: string | null, path: string, section = ''): string {
  const at = sha ?? 'HEAD';
  const anchor = section ? `#${githubAnchor(section)}` : '';
  return `https://github.com/${ref.owner}/${ref.repo}/blob/${at}/${path.split('/').map(encodeURIComponent).join('/')}${anchor}`;
}

export class RepoNotFound extends Error {}

/** Downloads the default branch and returns its documentation files, within `limits`. */
export async function readRepoMarkdown(
  ref: RepoRef,
  limits: ReadLimits = DEFAULT_LIMITS,
  onProgress?: (p: { files: number; archiveBytes: number }) => void,
): Promise<RepoRead> {
  const url = `https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/HEAD`;
  const abort = new AbortController();
  // Aborting the fetch does not reliably end a node stream piped from its body, so the timer destroys the stream too:
  // a read that hangs would otherwise hold a build slot for good.
  let gunzip: ReturnType<typeof createGunzip> | null = null;
  const timer = setTimeout(() => {
    abort.abort();
    gunzip?.destroy();
  }, limits.timeoutMs);
  const files: RepoFile[] = [];
  let totalBytes = 0;
  let archiveBytes = 0;
  let truncated = false;
  const decoder = new TextDecoder();
  let tar: TarStream | null = null;

  try {
    const res = await fetch(url, { signal: abort.signal, redirect: 'follow', headers: { 'user-agent': 'helpdock' } });
    if (res.status === 404) throw new RepoNotFound(`${ref.owner}/${ref.repo} is not a public GitHub repository`);
    if (!res.ok || !res.body) throw new Error(`GitHub answered ${res.status}`);

    tar = new TarStream({
      want: (path, size) => {
        const inRepo = path.slice(path.indexOf('/') + 1); // drop the "<owner>-<repo>-<sha>/" folder
        return inScope(inRepo, ref.scope) && isDocPath(inRepo) && size > 0 && size <= limits.maxFileBytes && files.length < limits.maxFiles * CANDIDATE_FACTOR;
      },
      onFile: (f) => {
        if (files.length >= limits.maxFiles * CANDIDATE_FACTOR || totalBytes + f.data.length > limits.maxTotalBytes * CANDIDATE_FACTOR) {
          truncated = true;
          return;
        }
        totalBytes += f.data.length;
        const path = f.path.slice(f.path.indexOf('/') + 1);
        files.push({ path, text: normalizeMarkdown(path, decoder.decode(f.data)) });
      },
    });

    // node:zlib (DecompressionStream is missing in older Bun releases), fed by hand with backpressure: the next
    // network chunk is read only once gunzip has drained, and its output goes straight into the tar reader. Piping
    // the web stream into it instead let Bun read a large archive ahead into memory, and a 512 MB instance died on it.
    const gz = createGunzip();
    gunzip = gz;
    const untar = tar;
    let stop = false;
    gz.on('data', (value: Uint8Array) => {
      if (stop) return;
      archiveBytes += value.length;
      untar.push(value);
      onProgress?.({ files: files.length, archiveBytes });
      if (untar.done) stop = true;
      if (archiveBytes > limits.maxArchiveBytes || files.length >= limits.maxFiles * CANDIDATE_FACTOR) {
        truncated = true;
        stop = true;
      }
    });
    const ended = new Promise<void>((resolve) => {
      gz.once('end', resolve);
      gz.once('close', resolve);
      gz.once('error', () => resolve());
    });
    const reader = res.body.getReader();
    let compressed = 0;
    try {
      let chunks = 0;
      while (!stop && !abort.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        // Untarring runs on the main thread: let requests in between chunks (see the indexing loop in repos.ts).
        if (++chunks % 16 === 0) await new Promise((r) => setImmediate(r));
        compressed += value.length;
        if (compressed > limits.maxArchiveBytes / 4 || rssMb() > MEMORY_LIMIT_MB) {
          if (rssMb() > MEMORY_LIMIT_MB) console.warn(`[github] ${ref.owner}/${ref.repo}: memory at ${Math.round(rssMb())} MB, keeping what was read`);
          truncated = true;
          break;
        }
        // Wait for gunzip to drain, or for the time limit: the timer destroys gz, and a destroyed stream never drains.
        if (!gz.write(value)) {
          await new Promise<void>((resolve) => {
            gz.once('drain', resolve);
            gz.once('close', resolve);
            gz.once('error', () => resolve());
            abort.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        }
      }
      if (!stop && !abort.signal.aborted) {
        gz.end();
        await ended;
      }
      if (abort.signal.aborted) truncated = true;
    } finally {
      stop = true;
      void reader.cancel().catch(() => {});
      gz.destroy();
    }
    if (abort.signal.aborted) return { ...selectDocs(files, limits), sha: tar.comment, truncated: true, archiveBytes };
    return { ...selectDocs(files, limits), sha: tar.comment, archiveBytes, truncated: truncated || files.length > limits.maxFiles };
  } catch (err) {
    if (abort.signal.aborted) {
      // Out of time: keep what was read.
      return { ...selectDocs(files, limits), sha: tar?.comment ?? null, truncated: true, archiveBytes };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** The best `maxFiles` files within `maxTotalBytes`, by docPriority, then path. */
export function selectDocs(files: RepoFile[], limits: Pick<ReadLimits, 'maxFiles' | 'maxTotalBytes'>): { files: RepoFile[] } {
  const ranked = [...files].sort((a, b) => docPriority(b.path) - docPriority(a.path) || a.path.localeCompare(b.path));
  const kept: RepoFile[] = [];
  let bytes = 0;
  for (const f of ranked) {
    if (kept.length >= limits.maxFiles) break;
    if (bytes + f.text.length > limits.maxTotalBytes) continue;
    kept.push(f);
    bytes += f.text.length;
  }
  return { files: kept.sort((a, b) => a.path.localeCompare(b.path)) };
}

export class RateLimited extends Error {}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'user-agent': 'helpdock', accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

/** Fetches `paths` with 16 requests at a time, normalized; a file that fails is skipped. */
async function fetchDocs(
  paths: string[],
  urlFor: (path: string) => string,
  signal: AbortSignal,
  onProgress?: (p: { files: number; archiveBytes: number }) => void,
): Promise<{ files: RepoFile[]; bytes: number }> {
  const files: RepoFile[] = [];
  const decoder = new TextDecoder();
  let next = 0;
  let bytes = 0;
  const worker = async () => {
    while (next < paths.length && !signal.aborted) {
      const path = paths[next++];
      try {
        const r = await fetch(urlFor(path), { signal, headers: { 'user-agent': 'helpdock' } });
        if (!r.ok) continue;
        const buf = new Uint8Array(await r.arrayBuffer());
        bytes += buf.length;
        files.push({ path, text: normalizeMarkdown(path, decoder.decode(buf)) });
        onProgress?.({ files: files.length, archiveBytes: bytes });
      } catch {
        // One missing file is not worth failing the repository for.
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, bytes };
}

/** The candidate documentation files of a listing, best first within the limits (sized placeholders for selectDocs). */
function chooseDocs(entries: Array<{ path: string; size: number }>, limits: ReadLimits) {
  const candidates = entries
    .filter((e) => isDocPath(e.path) && e.size > 0 && e.size <= limits.maxFileBytes)
    .map((e) => ({ path: e.path, text: ' '.repeat(e.size) }));
  return { chosen: selectDocs(candidates, limits).files.map((f) => f.path), candidates: candidates.length };
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

// When the API last said 403/429, it is not asked again until its limit resets (or for ten minutes).
let apiBlockedUntil = 0;

/** Lists the repository with the git trees API, then fetches the best documentation files from raw.githubusercontent.com. */
export async function readRepoViaApi(
  ref: RepoRef,
  limits: ReadLimits = DEFAULT_LIMITS,
  onProgress?: (p: { files: number; archiveBytes: number }) => void,
): Promise<RepoRead> {
  if (Date.now() < apiBlockedUntil) throw new RateLimited('GitHub API limit reached earlier');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), limits.timeoutMs);
  try {
    const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/HEAD?recursive=1`, {
      headers: githubHeaders(),
      signal: abort.signal,
    });
    if (res.status === 404 || res.status === 409) {
      throw new RepoNotFound(`${ref.owner}/${ref.repo} is not a public GitHub repository`);
    }
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      apiBlockedUntil = reset > Date.now() ? reset : Date.now() + 10 * 60 * 1000;
      throw new RateLimited(`GitHub API answered ${res.status}`);
    }
    if (!res.ok) throw new Error(`GitHub API answered ${res.status}`);
    const tree = (await res.json()) as { sha: string; truncated: boolean; tree: Array<{ path: string; type: string; size?: number }> };
    // A tree too big for one response comes back truncated; the other ways read all of it.
    if (tree.truncated) throw new RateLimited('tree listing truncated');
    const { chosen, candidates } = chooseDocs(
      tree.tree.filter((e) => e.type === 'blob' && inScope(e.path, ref.scope)).map((e) => ({ path: e.path, size: e.size ?? 0 })),
      limits,
    );
    const { files, bytes } = await fetchDocs(
      chosen,
      (path) => `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${tree.sha}/${encodePath(path)}`,
      abort.signal,
      onProgress,
    );
    return { files, sha: tree.sha, truncated: abort.signal.aborted || candidates > chosen.length, archiveBytes: bytes };
  } finally {
    clearTimeout(timer);
  }
}

const run = promisify(execFile);

/** git at the default branch, docs only (see the header). */
export async function readRepoViaGit(
  ref: RepoRef,
  limits: ReadLimits = DEFAULT_LIMITS,
  onProgress?: (p: { files: number; archiveBytes: number }) => void,
): Promise<RepoRead> {
  const dir = await mkdtemp(join(tmpdir(), 'helpdock-git-'));
  const deadline = Date.now() + limits.timeoutMs;
  const git = async (...args: string[]) => {
    const left = Math.max(1000, deadline - Date.now());
    const { stdout } = await run('git', args, {
      cwd: dir,
      timeout: left,
      maxBuffer: 64 * 1024 * 1024,
      // Never ask for credentials: a private or missing repository must fail, not wait for a prompt.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', GCM_INTERACTIVE: 'never' },
    });
    return stdout;
  };
  try {
    try {
      await git('clone', '--quiet', '--filter=blob:none', '--depth', '1', '--no-checkout', '--single-branch', `https://github.com/${ref.owner}/${ref.repo}.git`, 'repo');
    } catch (err) {
      const text = String((err as { stderr?: string }).stderr ?? err);
      if (/not found|could not read Username|terminal prompts disabled|Authentication failed/i.test(text)) {
        throw new RepoNotFound(`${ref.owner}/${ref.repo} is not a public GitHub repository`);
      }
      throw err;
    }
    const repo = join(dir, 'repo');
    const gitIn = (...args: string[]) => git('-C', repo, ...args);
    await gitIn('sparse-checkout', 'set', '--no-cone', ...sparsePatterns(ref.scope));
    await gitIn('checkout', '--quiet');
    const sha = (await gitIn('rev-parse', 'HEAD')).trim();
    const paths = (await gitIn('ls-files', '-z')).split('\0').filter(Boolean);
    const sized: Array<{ path: string; size: number }> = [];
    for (const path of paths) {
      if (!isDocPath(path) || !inScope(path, ref.scope)) continue;
      try {
        const st = await stat(join(repo, path));
        if (st.isFile()) sized.push({ path, size: st.size });
      } catch {
        // Not checked out (outside the sparse patterns): skip.
      }
    }
    const { chosen, candidates } = chooseDocs(sized, limits);
    const files: RepoFile[] = [];
    let bytes = 0;
    for (const path of chosen) {
      const text = await readFile(join(repo, path), 'utf8');
      bytes += text.length;
      files.push({ path, text: normalizeMarkdown(path, text) });
      onProgress?.({ files: files.length, archiveBytes: bytes });
      if (files.length % 16 === 0) await new Promise((r) => setImmediate(r));
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, sha, truncated: candidates > chosen.length, archiveBytes: bytes };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** `git ls-tree -r -z` output (`-l` adds sizes) as regular files (symlinks and submodules are not files). */
export function parseLsTree(output: string): Array<{ path: string; size: number }> {
  const out: Array<{ path: string; size: number }> = [];
  for (const entry of output.split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, , size] = entry.slice(0, tab).trim().split(/\s+/);
    // Without -l there is no size (git would download every file to learn it): 1 stands for "unknown, not empty".
    if (type === 'blob' && mode?.startsWith('100')) out.push({ path: entry.slice(tab + 1), size: Number(size) || 1 });
  }
  return out;
}

export interface RepoTree {
  sha: string;
  /** The documentation files worth showing, best first within the limits (see chooseDocs). */
  paths: Array<{ path: string; size: number }>;
  truncated: boolean;
}

/**
 * The repository's documentation files and commit, without downloading any file: a partial clone at depth 1 with no
 * blobs and no checkout, then `git ls-tree`. Only the file tree crosses the network (Next.js: about 2 s), so opening a
 * repository costs no memory beyond a list of paths; pages are fetched when someone opens them (fetchRaw).
 */
export async function listRepoDocs(ref: RepoRef, limits: ReadLimits = DEFAULT_LIMITS): Promise<RepoTree> {
  const dir = await mkdtemp(join(tmpdir(), 'helpdock-tree-'));
  const git = async (...args: string[]) => {
    const { stdout } = await run('git', args, {
      cwd: dir,
      timeout: limits.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', GCM_INTERACTIVE: 'never' },
    });
    return stdout;
  };
  try {
    try {
      await git('clone', '--quiet', '--filter=blob:none', '--depth', '1', '--no-checkout', '--single-branch', `https://github.com/${ref.owner}/${ref.repo}.git`, 'repo');
    } catch (err) {
      const text = String((err as { stderr?: string }).stderr ?? err);
      if (/not found|could not read Username|terminal prompts disabled|Authentication failed/i.test(text)) {
        throw new RepoNotFound(`${ref.owner}/${ref.repo} is not a public GitHub repository`);
      }
      throw err;
    }
    const repo = join(dir, 'repo');
    const sha = (await git('-C', repo, 'rev-parse', 'HEAD')).trim();
    // With a scope, the tree is that folder's (HEAD:folder), and its paths are put back under it.
    const listed = parseLsTree(await git('-C', repo, 'ls-tree', '-r', '-z', ref.scope ? `HEAD:${ref.scope}` : 'HEAD'));
    const files = ref.scope ? listed.map((f) => ({ ...f, path: `${ref.scope}/${f.path}` })) : listed;
    const { chosen, candidates } = chooseDocs(files.filter((f) => isDocPath(f.path)), limits);
    const sizes = new Map(files.map((f) => [f.path, f.size]));
    return { sha, paths: chosen.map((path) => ({ path, size: sizes.get(path) ?? 0 })), truncated: candidates > chosen.length };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** One file from raw.githubusercontent.com at a commit, normalized for display; null when it is missing or too big. */
export async function fetchRaw(ref: RepoRef, sha: string, path: string, maxBytes = DEFAULT_LIMITS.maxFileBytes): Promise<string | null> {
  const res = await fetch(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${sha}/${encodePath(path)}`, {
    headers: { 'user-agent': 'helpdock' },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > maxBytes) return null;
  return normalizeMarkdown(path, new TextDecoder().decode(buf));
}

/** git first, then GitHub's API, then the archive. A missing repository is final. */
export async function readRepoDocs(
  ref: RepoRef,
  limits: ReadLimits = DEFAULT_LIMITS,
  onProgress?: (p: { files: number; archiveBytes: number }) => void,
): Promise<RepoRead> {
  const name = `${ref.owner}/${ref.repo}`;
  try {
    const read = await readRepoViaGit(ref, limits, onProgress);
    if (read.files.length > 0) return read;
  } catch (err) {
    if (err instanceof RepoNotFound) throw err;
    console.warn(`[github] ${name}: git: ${(err as Error).message.split('\n')[0]}; trying the GitHub API`);
  }
  try {
    return await readRepoViaApi(ref, limits, onProgress);
  } catch (err) {
    if (err instanceof RepoNotFound) throw err;
    console.warn(`[github] ${name}: ${(err as Error).message}; reading the archive`);
  }
  return readRepoMarkdown(ref, { ...limits, timeoutMs: ARCHIVE_TIMEOUT_MS }, onProgress);
}

// The archive streams the whole repository, code before docs for most layouts, and GitHub serves it slowly at times.
const ARCHIVE_TIMEOUT_MS = 60_000;
