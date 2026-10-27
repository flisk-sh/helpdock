// Reading a public GitHub repository's Markdown, two ways:
//   readRepoViaApi      one call to the git trees API lists every file, then only the chosen docs are fetched from
//                       raw.githubusercontent.com, in parallel. Fast, and it downloads docs only. Unauthenticated, the
//                       API allows 60 calls an hour per address (GITHUB_TOKEN, optional, raises that).
//   readRepoMarkdown    GitHub's archive download (codeload.github.com, no API limit), gunzipped and untarred as it
//                       streams, keeping only documentation. The fallback when the API says no.
// readRepoDocs tries the first and falls back to the second. Both stop at fixed limits so a huge repository cannot
// exhaust a small instance. The hosts are fixed and the owner and name are validated, so a request can never make the
// server fetch an address of its choosing.
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
    body = out.join('\n');
  }
  body = mkdocsToMarkdown(body);
  if (title && !/^#\s+\S/m.test(body)) body = `# ${title}\n\n${body}`;
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
  const timer = setTimeout(() => abort.abort(), limits.timeoutMs);
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

    const reader = res.body.pipeThrough(new DecompressionStream('gzip')).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      archiveBytes += value.length;
      tar.push(value);
      onProgress?.({ files: files.length, archiveBytes });
      if (tar.done) break;
      if (archiveBytes > limits.maxArchiveBytes || files.length >= limits.maxFiles * CANDIDATE_FACTOR) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
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

/** Lists the repository with the git trees API, then fetches the best documentation files from raw.githubusercontent.com. */
export async function readRepoViaApi(
  ref: RepoRef,
  limits: ReadLimits = DEFAULT_LIMITS,
  onProgress?: (p: { files: number; archiveBytes: number }) => void,
): Promise<RepoRead> {
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
    if (res.status === 403 || res.status === 429) throw new RateLimited(`GitHub API answered ${res.status}`);
    if (!res.ok) throw new Error(`GitHub API answered ${res.status}`);
    const tree = (await res.json()) as { sha: string; truncated: boolean; tree: Array<{ path: string; type: string; size?: number }> };
    // A tree too big for one response comes back truncated; the archive reads all of it.
    if (tree.truncated) throw new RateLimited('tree listing truncated');

    const candidates = tree.tree
      .filter((e) => e.type === 'blob' && isDocPath(e.path) && (e.size ?? 0) > 0 && (e.size ?? 0) <= limits.maxFileBytes)
      .map((e) => ({ path: e.path, text: ' '.repeat(e.size ?? 0) })); // sized placeholders, for selectDocs
    const chosen = selectDocs(candidates, limits).files.map((f) => f.path);

    const files: RepoFile[] = [];
    let next = 0;
    let bytes = 0;
    const decoder = new TextDecoder();
    const worker = async () => {
      while (next < chosen.length && !abort.signal.aborted) {
        const path = chosen[next++];
        const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${tree.sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
        try {
          const r = await fetch(url, { signal: abort.signal, headers: { 'user-agent': 'helpdock' } });
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
    return {
      files,
      sha: tree.sha,
      truncated: abort.signal.aborted || candidates.length > chosen.length,
      archiveBytes: bytes,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The API path first; the archive when the API is rate limited, truncated or failing. A missing repository is final. */
export async function readRepoDocs(
  ref: RepoRef,
  limits: ReadLimits = DEFAULT_LIMITS,
  onProgress?: (p: { files: number; archiveBytes: number }) => void,
): Promise<RepoRead> {
  try {
    return await readRepoViaApi(ref, limits, onProgress);
  } catch (err) {
    if (err instanceof RepoNotFound) throw err;
    console.warn(`[github] ${ref.owner}/${ref.repo}: ${(err as Error).message}; reading the archive instead`);
    return readRepoMarkdown(ref, { ...limits, timeoutMs: ARCHIVE_TIMEOUT_MS }, onProgress);
  }
}

// The archive streams the whole repository, code before docs for most layouts, and GitHub serves it slowly at times.
const ARCHIVE_TIMEOUT_MS = 60_000;
