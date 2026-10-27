// The public MCP endpoint (POST /mcp): visitors add https://helpdock.flisk.sh/mcp to their own AI (Claude, ChatGPT,
// Cursor, Codex) and it searches these docs itself. Read-only on purpose: adding pages stays behind the admin token
// (POST /docs, or the local tools server's add_doc).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { type Answer, extractiveAnswer, type SearchHit } from './docs';

export interface McpDeps {
  search(query: string, limit: number): Promise<SearchHit[]>;
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function buildMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'helpdock', version: '1.0.0' });

  server.registerTool(
    'search_docs',
    {
      description:
        'Full-text search of the Helpdock help center. Returns matching sections with a snippet, the page title, ' +
        'the section and the source file. Use it to find what the docs say before answering.',
      inputSchema: { query: z.string().min(1).max(500), limit: z.number().int().min(1).max(20).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => text({ query, hits: await deps.search(query, limit ?? 5) }),
  );

  server.registerTool(
    'ask_help_center',
    {
      description:
        'Ask the help center a question. Returns the best matching passages, numbered, with their sources. ' +
        'Answer the user from these passages and cite them as [n].',
      inputSchema: { question: z.string().min(1).max(500) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ question }) => {
      const answer: Answer = extractiveAnswer(question, await deps.search(question, 5));
      return text(answer);
    },
  );

  return server;
}

// A new server and transport per request keeps the endpoint stateless, so a restart or a sleeping free instance loses
// no MCP session.
export async function handleMcp(req: IncomingMessage, res: ServerResponse, body: unknown, deps: McpDeps) {
  const server = buildMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
