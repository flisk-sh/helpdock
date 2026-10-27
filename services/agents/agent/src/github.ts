// Reading a public GitHub repository's Markdown, two ways, fastest first:
//   readRepoViaApi       one call to the git trees API lists every file, then only the chosen docs are fetched from
//                        raw.githubusercontent.com, in parallel. Unauthenticated, the API allows 60 calls an hour per
//                        address, and a host's address is often shared (GITHUB_TOKEN, optional, lifts that to 5000).
//   readRepoMarkdown     GitHub's archive download (codeload.github.com), gunzipped and untarred as it streams,
//                        keeping only documentation. Works for any public repository, slowly for big ones.
// readRepoDocs tries them in that order. (jsDelivr's GitHub mirror was tried and dropped: its branch listings can be
// months old, so it served docs that no longer exist.) Both stop at fixed limits so a huge repository cannot
// exhaust a small instance. The hosts are fixed and the owner and name are validated, so a request can never make the
// server fetch an address of its choosing.
import { createGunzip } from 'node:zlib';
import { TarStream } from './tar';

export interface RepoRef {
  owner: string;
  repo: string;
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
export function parseRepoPath(pathname: string): (RepoRef & { rest: string }) | null {
  const m = /^\/([^/]+)\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, '');
  if (RESERVED.has(owner.toLowerCase()) || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
    return null;
  }
  let rest = m[3] ?? '';
  // GitHub's own paths below a repository (tree/blob/wiki/...) all mean "this repository" here.
  if (/^\/(tree|blob|wiki|issues|pulls|discussions|releases)(\/|$)/.test(rest)) rest = '';
  return { owner, repo, rest };
}

/** Whether a path is documentation worth indexing. */
export function isDocPath(path: string): boolean {
  if (!/\.(md|mdx|markdown)$/i.test(path)) return false;
  const lower = path.toLowerCase();
  // Hidden folders (.github, .claude, agent worktrees) hold tooling, templates and copies, not documentation.
  if (/(^|\/)\.[^/]+\//.test(lower)) return false;
  if (/(^|\/)(node_modules|vendor|third_party|dist|build|target|fixtures?|__snapshots__|testdata)\//.test(lower)) {
    return false;
  }
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
  // Example and test folders inside the docs (docs/examples/) are documentation; elsewhere they are code samples.
  if (!inDocs && /(^|\/)(examples?|samples?|tests?|benchmarks?|scripts?)\//.test(lower)) score -= 2;
  return score - Math.max(0, depth - 3);
}

/**
 * Markdown or MDX as plain Markdown for indexing: front matter dropped (its `title` becomes the page heading when the
 * page has none), MDX import/export lines and JSX tags removed, their text kept.
 */
export function normalizeMarkdown(path: string, text: string): string {
  let body = text.replace(/\r\n/g, '\n');
  let title: string | null = null;
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(body);
  if (fm) {
    title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1])?.[1] ?? null;
    body = body.slice(fm[0].length);
  }
  if (/\.mdx$/i.test(path)) {
    const out: string[] = [];
    let inFence = false;
    for (const line of body.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (!inFence && /^(import|export)\s/.test(line)) continue;
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
        return isDocPath(inRepo) && size > 0 && size <= limits.maxFileBytes && files.length < limits.maxFiles * CANDIDATE_FACTOR;
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
      while (!stop && !abort.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
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
      tree.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, size: e.size ?? 0 })),
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

/** The GitHub API first, then the archive. A missing repository is final. */
export async function readRepoDocs(
  ref: RepoRef,
  limits: ReadLimits = DEFAULT_LIMITS,
  onProgress?: (p: { files: number; archiveBytes: number }) => void,
): Promise<RepoRead> {
  const name = `${ref.owner}/${ref.repo}`;
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
