import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { aiPrompt, type Answer, extractiveAnswer } from './docs';
import { clientIp, isAdmin, parseProxyMode, RateLimiter, securityHeaders } from './guard';
import { handleMcp } from './mcp';
import { seedPages } from './seed-docs.generated';
import type { Checkpoint } from './store';
import { createPostgresStores } from './store-postgres';
import { createSqliteStores } from './store-sqlite';
import { page } from './ui';

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
//   HELPDOCK_PUBLIC_URL     the page's public address, named in the prompt visitors take to their own AI
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
const pageHeaders = securityHeaders(page);
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

// A turn: search the docs and answer with the best passages, each cited. No model and no outside API: the reply
// is built from the docs alone, so the same question always gets the same answer.
async function runTurn(_checkpoint: Checkpoint, input: string, siteUrl: string): Promise<Answer & { prompt: string }> {
  const hits = await docs.search(input);
  return { ...extractiveAnswer(input, hits), prompt: aiPrompt(input, hits, siteUrl) };
}

// The public address of this page, for the prompt that visitors take to their own AI. HELPDOCK_PUBLIC_URL when set,
// else the request's own host.
function siteUrl(req: IncomingMessage): string {
  if (process.env.HELPDOCK_PUBLIC_URL) return process.env.HELPDOCK_PUBLIC_URL;
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

const server = createServer(async (req, res) => {
  inFlight++;
  res.on('close', () => inFlight--);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const ip = clientIp(req.headers, req.socket.remoteAddress, PROXY_MODE);
  res.setHeader('x-content-type-options', 'nosniff');

  try {
    if (url.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok', service: 'agent', draining });
    }

    if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'public, max-age=300');
      for (const [name, value] of Object.entries(pageHeaders)) res.setHeader(name, value);
      return res.end(req.method === 'HEAD' ? undefined : page);
    }

    if (url.pathname === '/search' && req.method === 'GET') {
      const wait = readLimit.hit(ip);
      if (wait) return tooMany(res, wait);
      const q = (url.searchParams.get('q') ?? '').slice(0, MAX_QUESTION_CHARS);
      if (!q.trim()) return sendJson(res, 400, { error: 'q is required' });
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 5, 1), 20);
      return sendJson(res, 200, { query: q, hits: await docs.search(q, limit) });
    }

    // Add or replace one page: { "source": "billing.md", "markdown": "# Billing ..." }.
    if (url.pathname === '/docs' && req.method === 'POST') {
      if (!canWriteDocs(req)) return sendJson(res, 403, { error: 'adding pages needs the admin token' });
      const body = await readJson(req, MAX_DOC_BYTES);
      const source = String(body.source ?? '').trim();
      if (!source || source.length > 512 || typeof body.markdown !== 'string') {
        return sendJson(res, 400, { error: 'source and markdown are required' });
      }
      return sendJson(res, 200, { source, sections: await docs.upsert(source, body.markdown) });
    }

    // Public, read-only MCP for the visitor's own AI. Stateless Streamable HTTP: POST only.
    if (url.pathname === '/mcp') {
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
      return handleMcp(req, res, body, { search: (q, limit) => docs.search(q.slice(0, MAX_QUESTION_CHARS), limit) });
    }

    if (url.pathname === '/ready') {
      const ok = !draining && (await store.ready());
      return sendJson(res, ok ? 200 : 503, { ready: ok, durability: DURABILITY });
    }

    // Session routing: the session id comes from the x-session-id header, so several instances of one agent can
    // share a Traefik route and each session still reaches its own checkpoint.
    if (url.pathname === '/turn' && req.method === 'POST') {
      if (draining) return sendJson(res, 503, { error: 'draining' });
      const sessionId = String(req.headers['x-session-id'] ?? '');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
        return sendJson(res, 400, { error: 'x-session-id header is required (1-128 letters, digits, - or _)' });
      }
      const body = await readJson(req);
      const input = String(body.input ?? '').trim();
      if (!input) return sendJson(res, 400, { error: 'input is required' });
      if (input.length > MAX_QUESTION_CHARS) {
        return sendJson(res, 400, { error: `input is over ${MAX_QUESTION_CHARS} characters` });
      }
      const wait = turnLimit.hit(ip);
      if (wait) return tooMany(res, wait);
      const checkpoint = await store.load(sessionId);
      checkpoint.messages.push({ role: 'user', content: input, at: new Date().toISOString() });
      const { reply, sources, prompt } = await runTurn(checkpoint, input, siteUrl(req));
      checkpoint.messages.push({ role: 'agent', content: reply, sources, at: new Date().toISOString() });
      checkpoint.messages = checkpoint.messages.slice(-MAX_SESSION_MESSAGES);
      await store.save(checkpoint);
      return sendJson(res, 200, { sessionId, reply, sources, prompt, turns: Math.ceil(checkpoint.messages.length / 2) });
    }

    if (url.pathname === '/session' && req.method === 'GET') {
      const sessionId = String(req.headers['x-session-id'] ?? '');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return sendJson(res, 400, { error: 'x-session-id header is required' });
      const checkpoint = await store.load(sessionId);
      return sendJson(res, 200, { sessionId, turns: checkpoint.messages.length / 2, messages: checkpoint.messages });
    }

    return sendJson(res, 404, { error: 'not_found' });
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
});

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
