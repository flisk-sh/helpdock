import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminHeaders, buildServer } from '../src/server.js';

async function connect() {
  const server = buildServer();
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe('adminHeaders', () => {
  const saved = process.env.HELPDOCK_ADMIN_TOKEN;
  afterEach(() => {
    if (saved === undefined) delete process.env.HELPDOCK_ADMIN_TOKEN;
    else process.env.HELPDOCK_ADMIN_TOKEN = saved;
  });

  it('sends no authorization header when the token is not set', () => {
    delete process.env.HELPDOCK_ADMIN_TOKEN;
    expect(adminHeaders()).toEqual({});
  });

  it('sends no authorization header when the token is empty', () => {
    process.env.HELPDOCK_ADMIN_TOKEN = '';
    expect(adminHeaders()).toEqual({});
  });

  it('sends a bearer token when it is set', () => {
    process.env.HELPDOCK_ADMIN_TOKEN = 's3cret';
    expect(adminHeaders()).toEqual({ authorization: 'Bearer s3cret' });
  });
});

describe('tools/list annotations', () => {
  it('marks search as read-only and add_doc as a destructive write', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName.search_docs).toMatchObject({ readOnlyHint: true });
    expect(byName.add_doc).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.ask_help_center).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });
});

describe('add_doc', () => {
  const saved = process.env.HELPDOCK_ADMIN_TOKEN;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.HELPDOCK_ADMIN_TOKEN;
    else process.env.HELPDOCK_ADMIN_TOKEN = saved;
  });

  async function addDoc() {
    const client = await connect();
    await client.callTool({ name: 'add_doc', arguments: { source: 'a.md', markdown: '# A' } });
    const [url, init] = fetchMock.mock.calls[0];
    return { url: String(url), headers: init.headers as Record<string, string> };
  }

  it('sends the bearer token only when it is set', async () => {
    process.env.HELPDOCK_ADMIN_TOKEN = 's3cret';
    const { url, headers } = await addDoc();
    expect(url.endsWith('/docs')).toBe(true);
    expect(headers.authorization).toBe('Bearer s3cret');
  });

  it('sends no authorization header when the token is not set', async () => {
    delete process.env.HELPDOCK_ADMIN_TOKEN;
    const { headers } = await addDoc();
    expect(headers.authorization).toBeUndefined();
  });

  it('does not send the token with a search', async () => {
    process.env.HELPDOCK_ADMIN_TOKEN = 's3cret';
    const client = await connect();
    await client.callTool({ name: 'search_docs', arguments: { query: 'port' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toBeUndefined();
  });
});
