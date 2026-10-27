import { describe, expect, it } from 'vitest';
import { parsePax, type TarFile, TarStream } from '../src/tar';

const enc = new TextEncoder();
const dec = new TextDecoder();

// A minimal tar writer for the tests: ustar headers, data padded to 512-byte blocks, two zero blocks at the end.
function header(name: string, size: number, type: string, prefix = ''): Uint8Array {
  const h = new Uint8Array(512);
  h.set(enc.encode(name).subarray(0, 100), 0);
  h.set(enc.encode(size.toString(8).padStart(11, '0')), 124);
  h[156] = type.charCodeAt(0);
  h.set(enc.encode('ustar\u000000'), 257);
  if (prefix) h.set(enc.encode(prefix), 345);
  return h;
}
function entry(name: string, body: string | Uint8Array, type = '0', prefix = ''): Uint8Array[] {
  const data = typeof body === 'string' ? enc.encode(body) : body;
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  return [header(name, data.length, type, prefix), padded];
}
function pax(records: Record<string, string>): Uint8Array {
  let out = '';
  for (const [k, v] of Object.entries(records)) {
    const body = ` ${k}=${v}\n`;
    let len = body.length + 1;
    while (String(len).length + body.length !== len) len = String(len).length + body.length;
    out += len + body;
  }
  return enc.encode(out);
}
function tar(...parts: Uint8Array[][]): Uint8Array {
  const blocks = [...parts.flat(), new Uint8Array(1024)];
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}
function read(archive: Uint8Array, chunk: number, want = (p: string) => p.endsWith('.md')) {
  const files: TarFile[] = [];
  const t = new TarStream({ want, onFile: (f) => files.push(f) });
  for (let i = 0; i < archive.length; i += chunk) t.push(archive.subarray(i, i + chunk));
  return { files: files.map((f) => [f.path, dec.decode(f.data)]), comment: t.comment, done: t.done };
}

describe('TarStream', () => {
  const archive = tar(
    entry('pax_global_header', pax({ comment: 'abc123' }), 'g'),
    entry('repo-abc123/', '', '5'),
    entry('repo-abc123/README.md', '# Hello\n\nWorld'),
    entry('repo-abc123/logo.png', new Uint8Array(1500)),
    entry('PaxHeader', pax({ path: `repo-abc123/docs/${'very-long-'.repeat(12)}guide.md` }), 'x'),
    entry('ignored-short-name', '## Long\n\nPath'),
    entry('guide.md', 'from prefix', '0', 'repo-abc123/docs'),
  );

  it('keeps wanted files, with pax, prefix and global header, at any chunk size', () => {
    for (const chunk of [1, 7, 512, 1000, archive.length]) {
      const r = read(archive, chunk);
      expect(r.comment).toBe('abc123');
      expect(r.done).toBe(true);
      expect(r.files).toEqual([
        ['repo-abc123/README.md', '# Hello\n\nWorld'],
        [`repo-abc123/docs/${'very-long-'.repeat(12)}guide.md`, '## Long\n\nPath'],
        ['repo-abc123/docs/guide.md', 'from prefix'],
      ]);
    }
  });

  it('never buffers files it does not want', () => {
    const seen: string[] = [];
    read(archive, 100, (p, ) => {
      seen.push(p);
      return false;
    });
    expect(seen).toContain('repo-abc123/logo.png');
  });

  it('reads GNU long names', () => {
    const long = `r/${'x'.repeat(120)}.md`;
    const r = read(tar(entry('././@LongLink', `${long}\u0000`, 'L'), entry('trunc', 'body')), 64);
    expect(r.files).toEqual([[long, 'body']]);
  });
});

describe('parsePax', () => {
  it('reads length-prefixed records', () => {
    expect(parsePax(pax({ path: 'a/b.md', comment: 'sha' }))).toEqual({ path: 'a/b.md', comment: 'sha' });
  });
});
