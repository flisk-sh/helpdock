import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { aiPrompt, type Answer, extractiveAnswer, type LinkFor, summarize } from './docs';
import { renderMarkdown } from '@flisk-sh/md2html';
import { docPriority, htmlToMarkdown, normalizeMarkdown, parseRepoPath, type RepoRef } from './github';
import { clientIp, isAdmin, parseProxyMode, RateLimiter, securityHeaders } from './guard';
import { handleMcp } from './mcp';
import { BusyError, RepoCache, type RepoEntry, repoLink } from './repos';
import { seedPages } from './seed-docs.generated';
import type { Checkpoint, DocStore, SessionStore } from './store';
import { createPostgresStores } from './store-postgres';
import { createSqliteStores } from './store-sqlite';
import { centerPage, EXAMPLE_REPOS, landingPage } from './ui';

// Contract with Flisk (see docs/agents/ai-agents.md):
//   AGENT_DURABILITY  postgres
//   DATABASE_URL      Postgres connection string injected by Flisk. Without it, Helpdock uses Bun's built-in SQLite
//                     (HELPDOCK_SQLITE_PATH, default :memory:), so an online deploy needs no database or account
//   PORT              port to listen on
// Helpdock settings:
//   HELPDOCK_DOCS_DIR Markdown folder loaded on first start when help_docs is empty; without it, the pages packed
//                     from seed-docs/ into src/seed-docs.generated.ts are loaded
// Online use:
//   HELPDOCK_ADMIN_TOKEN    bearer token for POST /docs. Without it, POST /docs is open in development (the MCP
//                           add_doc tool uses it) and off when NODE_ENV=production
//   HELPDOCK_PROXY          none (default), last-forwarded (Render) or cloudflare: where the client address comes
//                           from, so rate limits key on the real visitor (see parseProxyMode in guard.ts)
//   HELPDOCK_TURNS_PER_HOUR questions per client address per hour (default 60)
//   HELPDOCK_PUBLIC_URL     the site's public address, named in the prompt visitors take to their own AI
//   HELPDOCK_REPOS          1: serve a help center for any public GitHub repository at /owner/repo, and a landing
//                           page at / ("replace github.com with helpdock.flisk.sh"). Off: / is this help center
//   HELPDOCK_REPO_BUILDS_PER_HOUR new repositories one client address may have built per hour (default 10)
//   HELPDOCK_PREWARM        comma-separated owner/repo list built at start, so the landing page's examples open at
//                           once (default: the examples on the landing page)
// /health: the process is alive. /ready: the checkpoint store is reachable. Idle is healthy, so /health never checks the store.

const PORT = Number(process.env.PORT || 3000);
const DRAIN_TIMEOUT_MS = 10_000;

const DOCS_DIR = process.env.HELPDOCK_DOCS_DIR;
const ADMIN_TOKEN = process.env.HELPDOCK_ADMIN_TOKEN || undefined;
const PROXY_MODE = parseProxyMode(process.env.HELPDOCK_PROXY);
const MAX_QUESTION_CHARS = 500;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const turnLimit = new RateLimiter(Number(process.env.HELPDOCK_TURNS_PER_HOUR || 60), 60 * 60 * 1000);
const readLimit = new RateLimiter(300, 60 * 1000);
const REPOS = process.env.HELPDOCK_REPOS === '1';
const buildLimit = new RateLimiter(Number(process.env.HELPDOCK_REPO_BUILDS_PER_HOUR || 10), 60 * 60 * 1000);
const repos = new RepoCache();
const centerHeaders = securityHeaders(centerPage);
const landingHeaders = securityHeaders(landingPage);
const PRODUCTION = process.env.NODE_ENV === 'production';
// A session keeps its last 100 messages, so one long-lived visitor cannot grow a row without bound.
const MAX_SESSION_MESSAGES = 100;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const { store, docs } = process.env.DATABASE_URL
  ? createPostgresStores(process.env.DATABASE_URL)
  : createSqliteStores(process.env.HELPDOCK_SQLITE_PATH || ':memory:');
const DURABILITY = store.kind;

// The pages to load on a first start: the HELPDOCK_DOCS_DIR folder when set, else the packed starter pages.
async function seedSource(): Promise<{ from: string; pages: Record<string, string> }> {
  if (!DOCS_DIR) return { from: 'the packed seed-docs', pages: seedPages };
  const files = (await readdir(DOCS_DIR)).filter((f) => f.endsWith('.md'));
  const pages: Record<string, string> = {};
  for (const f of files) pages[f] = await readFile(join(DOCS_DIR, f), 'utf8');
  return { from: DOCS_DIR, pages };
}

// Load the seed pages into an empty table: once for Postgres, on every start for the in-memory SQLite. Retries while
// Postgres is still coming up.
async function seedDocs(): Promise<void> {
  let source: { from: string; pages: Record<string, string> };
  try {
    source = await seedSource();
  } catch (err) {
    console.error(`[agent] cannot read HELPDOCK_DOCS_DIR ${DOCS_DIR}; add pages with POST /docs`, err);
    return;
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if ((await docs.count()) > 0) return;
      let sections = 0;
      for (const [name, markdown] of Object.entries(source.pages)) sections += await docs.upsert(name, markdown);
      console.log(`[agent] seeded ${sections} sections from ${Object.keys(source.pages).length} pages (${source.from})`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error('[agent] gave up seeding docs: help_docs is unreachable');
}

// One help center: the root docs (this deployment's own pages) or a GitHub repository's.
interface Workspace {
  docs: DocStore;
  store: SessionStore;
  /** "Flisk docs" or "owner/repo", for the page and the MCP tools. */
  label: string;
  /** The path the help center lives at: "/" or "/owner/repo/". */
  base: string;
  /** Only the root docs take new pages (POST /docs, admin only). */
  writable: boolean;
  link?: LinkFor;
  repo?: RepoEntry;
}

const rootWorkspace: Workspace = { docs, store, label: process.env.HELPDOCK_LABEL || 'Flisk docs', base: '/', writable: true };

// A turn: search the docs and answer with the best passages, each cited. No model and no outside API: the reply
// is built from the docs alone, so the same question always gets the same answer.
async function runTurn(ws: Workspace, input: string, site: string): Promise<Answer & { prompt: string }> {
  const answer = extractiveAnswer(input, await ws.docs.search(input, 10), ws.link, htmlToMarkdown);
  // Each source also comes as HTML (md2html: sanitized, links and images resolved against the file on GitHub).
  const sources = answer.sources.map((src) => ({ ...src, html: renderMarkdown(src.excerpt, { baseUrl: src.url, headingIds: false }) }));
  return { ...answer, sources, prompt: aiPrompt(input, answer.sources, site + ws.base.slice(1)) };
}

// The public address of the site, for the prompt that visitors take to their own AI and the MCP address the page
// shows. HELPDOCK_PUBLIC_URL when set, else the request's own host.
function siteUrl(req: IncomingMessage): string {
  if (process.env.HELPDOCK_PUBLIC_URL) return process.env.HELPDOCK_PUBLIC_URL.replace(/\/?$/, '/');
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
  return `${proto}://${req.headers.host ?? 'localhost'}/`;
}

let draining = false;
let inFlight = 0;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<any> {
  const tooLarge = new HttpError(413, `body is over ${maxBytes} bytes`);
  if (Number(req.headers['content-length']) > maxBytes) throw tooLarge;
  // Read to the end even past the limit (keeping nothing): Bun's node:http drops the reply to a request whose body
  // was left half read, and the client would see an empty 200 instead of the 413.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= maxBytes) chunks.push(chunk as Buffer);
  }
  if (size > maxBytes) throw tooLarge;
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'body is not JSON');
  }
}

function tooMany(res: ServerResponse, retryAfter: number) {
  res.setHeader('retry-after', String(retryAfter));
  return sendJson(res, 429, { error: 'too many requests', retryAfter });
}

function canWriteDocs(req: IncomingMessage): boolean {
  if (ADMIN_TOKEN) return isAdmin(req.headers.authorization, ADMIN_TOKEN);
  return !PRODUCTION;
}

// The page list with priorities and summaries, built once per index and kept until the index changes (a summary per
// page is real work: 470 of them took 2.7 s per request on a 0.1 CPU instance). Keyed by the store, checked by count.
const pageLists = new WeakMap<DocStore, { count: number; pages: unknown[] }>();
async function pageList(docs: DocStore) {
  const count = await docs.count();
  const cached = pageLists.get(docs);
  if (cached && cached.count === count) return cached.pages;
  const pages = (await docs.pages()).map(({ lead, ...p }) => ({ ...p, priority: docPriority(p.source), summary: summarize(lead ?? '') }));
  pageLists.set(docs, { count, pages });
  return pages;
}

// Rendered pages, kept per index: a long README (36 sections, 132 images) took 1.5 s to render on 0.1 CPU. Least
// recently used pages go past 300, and a changed index (new count) renders again.
const renderedPages = new Map<string, { docs: DocStore; count: number; page: unknown }>();
async function renderedPage(ws: Workspace, source: string) {
  const key = `${ws.base}\u0000${source}`;
  const count = await ws.docs.count();
  const hit = renderedPages.get(key);
  if (hit && hit.docs === ws.docs && hit.count === count) {
    renderedPages.delete(key);
    renderedPages.set(key, hit);
    return hit.page;
  }
  const found = await ws.docs.page(source);
  if (!found) return null;
  const url = ws.link?.({ source, section: '' } as never);
  const sections = found.sections.map((sec) => ({ ...sec, html: renderMarkdown(sec.body, { baseUrl: url, headingIds: false }) }));
  const page = { ...found, sections, url };
  renderedPages.set(key, { docs: ws.docs, count, page });
  if (renderedPages.size > 300) renderedPages.delete(renderedPages.keys().next().value as string);
  return page;
}

function sendPage(req: IncomingMessage, res: ServerResponse, html: string, headers: Record<string, string>) {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=300');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  return res.end(req.method === 'HEAD' ? undefined : html);
}

function validSession(req: IncomingMessage): string | null {
  const id = String(req.headers['x-session-id'] ?? '');
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

function repoStatus(entry: RepoEntry, site: string) {
  const { owner, repo } = entry.ref;
  return {
    kind: 'repo',
    label: `${owner}/${repo}`,
    status: entry.status === 'ready' && !entry.stores ? 'error' : entry.status,
    error: entry.error,
    notFound: entry.notFound,
    github: `https://github.com/${owner}/${repo}`,
    sha: entry.sha,
    files: entry.files,
    sections: entry.sections,
    truncated: entry.truncated,
    indexing: entry.indexing,
    queued: entry.queued,
    progress: entry.progress,
    mcpUrl: `${site}${owner}/${repo}/mcp`,
  };
}

/** The repository's workspace once its index is ready, waiting up to `waitMs` for a build in progress. */
async function repoWorkspace(entry: RepoEntry, waitMs: number): Promise<Workspace | null> {
  if (entry.status === 'building' && !entry.stores) {
    await Promise.race([entry.ready, new Promise((r) => setTimeout(r, waitMs))]);
  }
  if (!entry.stores) return null;
  const { owner, repo } = entry.ref;
  return {
    ...entry.stores,
    label: `${owner}/${repo}`,
    base: `/${owner}/${repo}/`,
    writable: false,
    link: repoLink(entry),
    repo: entry,
  };
}

// The routes of one help center, below its base path.
async function serveWorkspace(ws: Workspace, sub: string, req: IncomingMessage, res: ServerResponse, url: URL, ip: string) {
  const site = siteUrl(req);

  if (sub === 'status' && req.method === 'GET') {
    if (ws.repo) return sendJson(res, 200, repoStatus(ws.repo, site));
    return sendJson(res, 200, { kind: 'docs', label: ws.label, status: 'ready', mcpUrl: `${site}mcp`, sections: await ws.docs.count() });
  }

  if (sub === 'pages' && req.method === 'GET') {
    res.setHeader('cache-control', 'public, max-age=60');
    return sendJson(res, 200, { pages: await pageList(ws.docs) });
  }

  if (sub === 'page' && req.method === 'GET') {
    const source = url.searchParams.get('source') ?? '';
    const rendered = source ? await renderedPage(ws, source) : null;
    if (!rendered) return sendJson(res, 404, { error: 'no such page' });
    res.setHeader('cache-control', 'public, max-age=60');
    return sendJson(res, 200, rendered);
  }

  if (sub === 'search' && req.method === 'GET') {
    const wait = readLimit.hit(ip);
    if (wait) return tooMany(res, wait);
    const q = (url.searchParams.get('q') ?? '').slice(0, MAX_QUESTION_CHARS);
    if (!q.trim()) return sendJson(res, 400, { error: 'q is required' });
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 5, 1), 20);
    const hits = (await ws.docs.search(q, limit)).map(({ body: _body, ...h }) => ({ ...h, url: ws.link?.(h) }));
    return sendJson(res, 200, { query: q, hits });
  }

  // Add or replace one page: { "source": "billing.md", "markdown": "# Billing ..." }.
  if (sub === 'docs' && req.method === 'POST' && ws.writable) {
    if (!canWriteDocs(req)) return sendJson(res, 403, { error: 'adding pages needs the admin token' });
    const body = await readJson(req, MAX_DOC_BYTES);
    const source = String(body.source ?? '').trim();
    if (!source || source.length > 512 || typeof body.markdown !== 'string') {
      return sendJson(res, 400, { error: 'source and markdown are required' });
    }
    return sendJson(res, 200, { source, sections: await ws.docs.upsert(source, body.markdown) });
  }

  // Public, read-only MCP for the visitor's own AI. Stateless Streamable HTTP: POST only.
  if (sub === 'mcp') {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, accept, mcp-protocol-version');
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      return sendJson(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
    }
    const wait = readLimit.hit(ip);
    if (wait) return tooMany(res, wait);
    const body = await readJson(req);
    return handleMcp(req, res, body, {
      name: ws.label,
      search: (q, limit) => ws.docs.search(q.slice(0, MAX_QUESTION_CHARS), limit),
      link: ws.link,
    });
  }

  // Session routing: the session id comes from the x-session-id header, so several instances of one agent can
  // share a Traefik route and each session still reaches its own checkpoint.
  if (sub === 'turn' && req.method === 'POST') {
    if (draining) return sendJson(res, 503, { error: 'draining' });
    const sessionId = validSession(req);
    if (!sessionId) return sendJson(res, 400, { error: 'x-session-id header is required (1-128 letters, digits, - or _)' });
    const body = await readJson(req);
    const input = String(body.input ?? '').trim();
    if (!input) return sendJson(res, 400, { error: 'input is required' });
    if (input.length > MAX_QUESTION_CHARS) return sendJson(res, 400, { error: `input is over ${MAX_QUESTION_CHARS} characters` });
    const wait = turnLimit.hit(ip);
    if (wait) return tooMany(res, wait);
    const checkpoint: Checkpoint = await ws.store.load(sessionId);
    checkpoint.messages.push({ role: 'user', content: input, at: new Date().toISOString() });
    const { reply, sources, prompt } = await runTurn(ws, input, site);
    checkpoint.messages.push({ role: 'agent', content: reply, sources, at: new Date().toISOString() });
    checkpoint.messages = checkpoint.messages.slice(-MAX_SESSION_MESSAGES);
    await ws.store.save(checkpoint);
    return sendJson(res, 200, { sessionId, reply, sources, prompt, turns: Math.ceil(checkpoint.messages.length / 2) });
  }

  if (sub === 'session' && req.method === 'GET') {
    const sessionId = validSession(req);
    if (!sessionId) return sendJson(res, 400, { error: 'x-session-id header is required' });
    const checkpoint = await ws.store.load(sessionId);
    return sendJson(res, 200, { sessionId, turns: checkpoint.messages.length / 2, messages: checkpoint.messages });
  }

  return sendJson(res, 404, { error: 'not_found' });
}

// The README, straight from raw.githubusercontent.com (no API, no limit), rendered at once: what a visitor reads while
// the search index builds. Kept per repository for ten minutes.
const readmes = new Map<string, { at: number; body: unknown }>();
async function readme(ref: RepoRef) {
  const key = `${ref.owner}/${ref.repo}`.toLowerCase();
  const hit = readmes.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.body;
  for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.mdx', 'docs/README.md']) {
    const res = await fetch(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/HEAD/${name}`, {
      headers: { 'user-agent': 'helpdock' },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res?.ok) continue;
    const url = `https://github.com/${ref.owner}/${ref.repo}/blob/HEAD/${name}`;
    const markdown = normalizeMarkdown(name, (await res.text()).slice(0, 512 * 1024));
    const body = { source: name, url, html: renderMarkdown(markdown, { baseUrl: url }) };
    readmes.set(key, { at: Date.now(), body });
    if (readmes.size > 200) readmes.delete(readmes.keys().next().value as string);
    return body;
  }
  return null;
}

async function serveRepo(ref: RepoRef & { rest: string }, req: IncomingMessage, res: ServerResponse, url: URL, ip: string) {
  // /owner/repo → /owner/repo/, so the page's relative API paths resolve below the repository.
  if (ref.rest === '' && !url.pathname.endsWith('/')) {
    res.statusCode = 308;
    res.setHeader('location', `/${ref.owner}/${ref.repo}/${url.search}`);
    return res.end();
  }
  const sub = ref.rest.replace(/^\//, '').replace(/\/$/, '');
  if (sub === 'readme' && req.method === 'GET') {
    const wait = readLimit.hit(ip);
    if (wait) return tooMany(res, wait);
    const body = await readme(ref);
    if (!body) return sendJson(res, 404, { error: 'no README' });
    res.setHeader('cache-control', 'public, max-age=300');
    return sendJson(res, 200, body);
  }
  let entry: RepoEntry;
  try {
    entry = repos.get(ref, () => buildLimit.hit(ip) === 0);
  } catch (err) {
    if (!(err instanceof BusyError)) throw err;
    if (sub === '' && (req.method === 'GET' || req.method === 'HEAD')) return sendPage(req, res, centerPage, centerHeaders);
    res.setHeader('retry-after', '5');
    const message = err.message === 'limit' ? 'You have opened many new repositories this hour; try again later.' : 'Busy reading other repositories; try again in a few seconds.';
    return sendJson(res, 503, { status: 'busy', error: message });
  }
  // The page renders at once and follows the build through /status.
  if (sub === '' && (req.method === 'GET' || req.method === 'HEAD')) return sendPage(req, res, centerPage, centerHeaders);
  if (sub === 'status') return sendJson(res, 200, repoStatus(entry, siteUrl(req)));
  const ws = await repoWorkspace(entry, sub === 'mcp' ? 40_000 : 20_000);
  if (!ws) {
    const status = entry.status === 'building' ? 503 : entry.notFound ? 404 : 502;
    if (status === 503) res.setHeader('retry-after', '3');
    return sendJson(res, status, { status: entry.status, error: entry.error ?? 'Still reading the repository.' });
  }
  return serveWorkspace(ws, sub, req, res, url, ip);
}

const server = createServer(async (req, res) => {
  inFlight++;
  res.on('close', () => inFlight--);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const ip = clientIp(req.headers, req.socket.remoteAddress, PROXY_MODE);
  res.setHeader('x-content-type-options', 'nosniff');

  try {
    if (url.pathname === '/health') {
      const mem = process.memoryUsage();
      return sendJson(res, 200, {
        status: 'ok',
        service: 'agent',
        draining,
        memory: { rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576) },
        repos: repos.stats(),
      });
    }
    if (url.pathname === '/ready') {
      const ok = !draining && (await store.ready());
      return sendJson(res, ok ? 200 : 503, { ready: ok, durability: DURABILITY });
    }
    if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      return REPOS ? sendPage(req, res, landingPage, landingHeaders) : sendPage(req, res, centerPage, centerHeaders);
    }
    // The root docs' own help center, at /docs/ when the landing page has /. Its API is at the root either way.
    if (REPOS && (url.pathname === '/docs/' || url.pathname === '/docs') && req.method === 'GET') {
      return sendPage(req, res, centerPage, centerHeaders);
    }
    if (REPOS) {
      const ref = parseRepoPath(url.pathname);
      if (ref) return await serveRepo(ref, req, res, url, ip);
    }
    const sub = url.pathname.replace(/^\/(docs\/)?/, '').replace(/\/$/, '');
    return await serveWorkspace(rootWorkspace, sub === '' && url.pathname.startsWith('/docs') ? 'docs' : sub, req, res, url, ip);
  } catch (error) {
    if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
    console.error('[agent] request failed:', error);
    return sendJson(res, 500, { error: 'internal_error' });
  }
});

// Bind beyond loopback: Traefik (or Render's proxy) reaches the container over the network.
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🤖 agent agent on http://localhost:' + PORT + ' (store: ' + DURABILITY + ')');
  void seedDocs();
  if (REPOS) void prewarm();
});

// Build the landing page's example repositories one after another, after start, so a visitor who clicks one gets
// an index that is already there.
async function prewarm() {
  // After start, the visitor who woke the instance comes first.
  await new Promise((r) => setTimeout(r, Number(process.env.HELPDOCK_PREWARM_DELAY_MS ?? 30_000)));
  const list = (process.env.HELPDOCK_PREWARM ?? EXAMPLE_REPOS.join(','))
    .split(',')
    .map((r) => parseRepoPath(`/${r.trim()}`))
    .filter((r): r is RepoRef & { rest: string } => r !== null);
  for (const ref of list) {
    // Visitors first: wait while any build runs, so pre-building never takes the slot a visitor needs.
    while (repos.stats().building > 0) await new Promise((r) => setTimeout(r, 2000));
    try {
      const entry = repos.get(ref);
      await entry.ready;
      if (entry.stores) await pageList(entry.stores.docs); // warm the page list too
    } catch {
      // Busy or over memory: the example builds on its first visit instead.
    }
  }
}

// Drain on SIGTERM (flisk down, hot reload, docker stop): stop taking turns, let in-flight turns finish, then exit 0.
// Checkpoints are written before a turn is answered, so a drained exit loses no acknowledged turn.
function shutdown(signal: string) {
  if (draining) return;
  draining = true;
  console.log('[agent] ' + signal + ' received, draining ' + inFlight + ' in-flight request(s)');
  server.close(async () => {
    await store.close();
  });
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  const timer = setInterval(async () => {
    if (inFlight === 0 || Date.now() > deadline) {
      clearInterval(timer);
      await store.close();
      process.exit(0);
    }
  }, 100);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
