import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleMcp } from '../src/mcp';

// The real endpoint on a local port, so the SDK sees real headers and a real body.
let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    await handleMcp(req, res, raw ? JSON.parse(raw) : undefined, {} as any);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
const post = (accept: string | undefined) =>
  fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(accept === undefined ? {} : { accept }) },
    body: JSON.stringify(init),
  });

describe('MCP endpoint accepts a JSON-only client', () => {
  it('does not answer 406 when the client accepts only JSON', async () => {
    const res = await post('application/json');
    expect(res.status).not.toBe(406);
    expect(await res.text()).toContain('serverInfo');
  });

  it('still answers a client that accepts both', async () => {
    const res = await post('application/json, text/event-stream');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('serverInfo');
  });

  it('answers a client that sends no accept header', async () => {
    const res = await post(undefined);
    expect(res.status).not.toBe(406);
  });
});
