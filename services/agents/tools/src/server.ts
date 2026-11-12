import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// The help center lives in the agent; these tools forward to it, so Claude Code, Cursor or Codex can search the same
// docs your users do. AGENT_URL is the agent as seen from this container.
const AGENT_URL = (process.env.AGENT_URL || 'http://agent:4001').replace(/\/$/, '');

async function agent(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(AGENT_URL + path, init);
  const body = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(body.error || `agent answered ${res.status}`);
  return body;
}

// The bearer token goes out only when HELPDOCK_ADMIN_TOKEN is set; read per call so a test can change it.
export function adminHeaders(): Record<string, string> {
  const token = process.env.HELPDOCK_ADMIN_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

// A new McpServer per request keeps the endpoint stateless, so there is no session to lose when the container restarts.
export function buildServer() {
  const server = new McpServer({ name: 'helpdock', version: '1.0.0' });

  server.registerTool(
    'search_docs',
    {
      description: 'Full-text search of the help center. Returns matching sections with a snippet, title and source file.',
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(20).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) =>
      text(await agent(`/search?q=${encodeURIComponent(query)}&limit=${limit ?? 5}`)),
  );

  server.registerTool(
    'ask_help_center',
    {
      description: 'Ask the help center a question. Returns an answer with numbered citations and the cited sources.',
      inputSchema: { question: z.string(), sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional() },
      // It records the turn in the session, so it is not read-only, but it removes nothing.
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ question, sessionId }) =>
      text(
        await agent('/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-session-id': sessionId ?? 'mcp' },
          body: JSON.stringify({ input: question }),
        }),
      ),
  );

  server.registerTool(
    'add_doc',
    {
      description: 'Add or replace one help center page from Markdown. Sections are split on #, ## and ### headings.',
      inputSchema: { source: z.string().min(1), markdown: z.string() },
      // Replaces an existing page with the same source.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ source, markdown }) =>
      text(
        await agent('/docs', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...adminHeaders() },
          body: JSON.stringify({ source, markdown }),
        }),
      ),
  );

  return server;
}
