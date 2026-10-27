import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Client } from 'pg';
import { type Answer, buildPrompt, chunkMarkdown, citedAnswer, extractiveAnswer, type SearchHit } from './docs';
import { seedPages } from './seed-docs.generated';
import { page } from './ui';

// Contract with Flisk (see docs/agents/ai-agents.md):
//   AGENT_DURABILITY  postgres
//   DATABASE_URL      Postgres connection string injected by Flisk
//   PORT              port to listen on
// Helpdock settings:
//   ANTHROPIC_API_KEY optional; with it answers are written by Claude from the passages, without it they are quoted
//   HELPDOCK_MODEL    Claude model id (default claude-haiku-5-5)
//   HELPDOCK_DOCS_DIR Markdown folder loaded on first start when help_docs is empty; without it, the pages packed
//                     from seed-docs/ into src/seed-docs.generated.ts are loaded
// /health: the process is alive. /ready: the checkpoint store is reachable. Idle is healthy, so /health never checks the store.

const DURABILITY = 'postgres';
const PORT = Number(process.env.PORT || 3000);
const DRAIN_TIMEOUT_MS = 10_000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

const MODEL = process.env.HELPDOCK_MODEL || 'claude-haiku-5-5';
const DOCS_DIR = process.env.HELPDOCK_DOCS_DIR;

interface Checkpoint {
  sessionId: string;
  messages: Array<{ role: 'user' | 'agent'; content: string; at: string; sources?: Answer['sources'] }>;
}

// The flisk_agent_sessions table is created by agent-migrator before this process starts.
let client: Client | null = null;

async function getClient(): Promise<Client> {
  if (client) return client;
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  client = c;
  return client;
}

const store = {
  async ready(): Promise<boolean> {
    try {
      const c = await getClient();
      await c.query('SELECT 1');
      return true;
    } catch {
      client = null;
      return false;
    }
  },
  async load(sessionId: string): Promise<Checkpoint> {
    try {
      const c = await getClient();
      const res = await c.query('SELECT messages FROM flisk_agent_sessions WHERE session_id = $1', [sessionId]);
      if (res.rows.length > 0 && res.rows[0].messages) {
        return { sessionId, messages: res.rows[0].messages };
      }
      return { sessionId, messages: [] };
    } catch (err) {
      console.error('[agent] load checkpoint failed:', err);
      return { sessionId, messages: [] };
    }
  },
  async save(checkpoint: Checkpoint): Promise<void> {
    const c = await getClient();
    await c.query(
      `INSERT INTO flisk_agent_sessions (session_id, messages, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (session_id) DO UPDATE
       SET messages = EXCLUDED.messages, updated_at = NOW()`,
      [checkpoint.sessionId, JSON.stringify(checkpoint.messages)],
    );
  },
  async close(): Promise<void> {
    if (client) {
      try {
        await client.end();
      } catch (err) {
        console.warn('[agent] closing the checkpoint client failed:', err);
      }
      client = null;
    }
  },
};

// The help_docs table is created by agent-migrator (prisma/migrations/*_help_docs).
const docs = {
  async search(query: string, limit = 5): Promise<SearchHit[]> {
    const c = await getClient();
    const res = await c.query(
      `SELECT id, source, title, section,
              ts_headline('english', body, q, 'MaxWords=60, MinWords=25, MaxFragments=2, FragmentDelimiter=" … "') AS snippet,
              ts_rank(search, q) AS rank
       FROM help_docs, websearch_to_tsquery('english', $1) q
       WHERE search @@ q
       ORDER BY rank DESC
       LIMIT $2`,
      [query, limit],
    );
    return res.rows.map((r) => ({ ...r, id: Number(r.id), rank: Number(r.rank) }));
  },
  async upsert(source: string, markdown: string): Promise<number> {
    const c = await getClient();
    const chunks = chunkMarkdown(source, markdown);
    await c.query('BEGIN');
    try {
      await c.query('DELETE FROM help_docs WHERE source = $1', [source]);
      for (const ch of chunks) {
        await c.query('INSERT INTO help_docs (source, title, section, body) VALUES ($1, $2, $3, $4)', [
          ch.source,
          ch.title,
          ch.section,
          ch.body,
        ]);
      }
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    }
    return chunks.length;
  },
  async count(): Promise<number> {
    const c = await getClient();
    const res = await c.query('SELECT count(*)::int AS n FROM help_docs');
    return res.rows[0].n;
  },
};

// The pages to load on a first start: the HELPDOCK_DOCS_DIR folder when set, else the packed starter pages.
async function seedSource(): Promise<{ from: string; pages: Record<string, string> }> {
  if (!DOCS_DIR) return { from: 'the packed seed-docs', pages: seedPages };
  const files = (await readdir(DOCS_DIR)).filter((f) => f.endsWith('.md'));
  const pages: Record<string, string> = {};
  for (const f of files) pages[f] = await readFile(join(DOCS_DIR, f), 'utf8');
  return { from: DOCS_DIR, pages };
}

// Load the seed pages once, on the first start against an empty table. Retries while Postgres is still coming up.
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
      client = null;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error('[agent] gave up seeding docs: help_docs is unreachable');
}

async function askClaude(question: string, hits: SearchHit[]): Promise<string> {
  const { system, user } = buildPrompt(question, hits);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': String(process.env.ANTHROPIC_API_KEY),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Claude answered ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return body.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// A turn: search the docs, then answer from the hits. Claude writes the answer when a key is set; otherwise, or when
// the call fails, the reply quotes the best passages, so the help center works with no key at all.
async function runTurn(_checkpoint: Checkpoint, input: string): Promise<Answer> {
  const hits = await docs.search(input);
  if (hits.length > 0 && process.env.ANTHROPIC_API_KEY) {
    try {
      return citedAnswer(await askClaude(input, hits), hits);
    } catch (err) {
      console.error('[agent] Claude call failed, quoting the docs instead:', err);
    }
  }
  return extractiveAnswer(input, hits);
}

let draining = false;
let inFlight = 0;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  inFlight++;
  res.on('close', () => inFlight--);
  const url = new URL(req.url ?? '/', 'http://localhost');

  try {
    if (url.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok', service: 'agent', draining });
    }

    if (url.pathname === '/' && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(page);
    }

    if (url.pathname === '/search' && req.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      if (!q.trim()) return sendJson(res, 400, { error: 'q is required' });
      return sendJson(res, 200, { query: q, hits: await docs.search(q, Number(url.searchParams.get('limit') || 5)) });
    }

    // Add or replace one page: { "source": "billing.md", "markdown": "# Billing ..." }.
    if (url.pathname === '/docs' && req.method === 'POST') {
      const body = await readJson(req);
      const source = String(body.source ?? '').trim();
      if (!source || typeof body.markdown !== 'string') {
        return sendJson(res, 400, { error: 'source and markdown are required' });
      }
      return sendJson(res, 200, { source, sections: await docs.upsert(source, body.markdown) });
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
      const input = String(body.input ?? '');
      const checkpoint = await store.load(sessionId);
      checkpoint.messages.push({ role: 'user', content: input, at: new Date().toISOString() });
      const { reply, sources } = await runTurn(checkpoint, input);
      checkpoint.messages.push({ role: 'agent', content: reply, sources, at: new Date().toISOString() });
      await store.save(checkpoint);
      return sendJson(res, 200, { sessionId, reply, sources, turns: checkpoint.messages.length / 2 });
    }

    if (url.pathname === '/session' && req.method === 'GET') {
      const sessionId = String(req.headers['x-session-id'] ?? '');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return sendJson(res, 400, { error: 'x-session-id header is required' });
      const checkpoint = await store.load(sessionId);
      return sendJson(res, 200, { sessionId, turns: checkpoint.messages.length / 2, messages: checkpoint.messages });
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error('[agent] request failed:', error);
    return sendJson(res, 500, { error: 'internal_error' });
  }
});

// Bind beyond loopback: Traefik reaches the container over the Docker network.
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🤖 agent agent on http://localhost:' + PORT + ' (durability: ' + DURABILITY + ')');
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
