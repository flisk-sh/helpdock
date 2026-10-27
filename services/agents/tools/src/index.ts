import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

// The help center lives in the agent; these tools forward to it, so Claude Code, Cursor or Codex can search the same
// docs your users do. AGENT_URL is the agent as seen from this container.
const AGENT_URL = (process.env.AGENT_URL || 'http://agent:4001').replace(/\/$/, '');

async function agent(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(AGENT_URL + path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `agent answered ${res.status}`);
  return body;
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

// A new McpServer per request keeps the endpoint stateless, so there is no session to lose when the container restarts.
function buildServer() {
  const server = new McpServer({ name: 'helpdock', version: '1.0.0' });

  server.registerTool(
    'search_docs',
    {
      description: 'Full-text search of the help center. Returns matching sections with a snippet, title and source file.',
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(20).optional() },
    },
    async ({ query, limit }) =>
      text(await agent(`/search?q=${encodeURIComponent(query)}&limit=${limit ?? 5}`)),
  );

  server.registerTool(
    'ask_help_center',
    {
      description: 'Ask the help center a question. Returns an answer with numbered citations and the cited sources.',
      inputSchema: { question: z.string(), sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional() },
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
    },
    async ({ source, markdown }) =>
      text(
        await agent('/docs', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(process.env.HELPDOCK_ADMIN_TOKEN ? { authorization: `Bearer ${process.env.HELPDOCK_ADMIN_TOKEN}` } : {}),
          },
          body: JSON.stringify({ source, markdown }),
        }),
      ),
  );

  return server;
}

async function readBody(req: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

const httpServer = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  // Health check endpoint (required by TILT_RESOURCE_DEFAULTS.star)
  if (path === '/health') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', service: 'tools' }));
    return;
  }

  // MCP over Streamable HTTP. Clients POST JSON-RPC here.
  if (path === '/mcp') {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('allow', 'POST');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
      return;
    }

    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, await readBody(req));
    return;
  }

  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'not_found' }));
});

const port = Number(process.env.PORT || 3000);

// Bind beyond loopback: Traefik reaches the container over the Docker network.
httpServer.listen(port, '0.0.0.0', () => {
  console.log('\n🚀 tools MCP server on http://localhost:' + port + '/mcp');
  console.log('📊 Health check: http://localhost:' + port + '/health\n');
});
