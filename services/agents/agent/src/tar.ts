// A streaming reader for (uncompressed) tar archives, enough for GitHub's repository archives: ustar entries, pax
// extended headers (long paths, and the global header where GitHub puts the commit id) and GNU long names. Feed it
// chunks of any size with push(); it keeps only the files `want` accepts, so a large repository costs no memory for
// the files it skips. No I/O, so tests/tar.test.ts covers all of it.

const BLOCK = 512;
const decoder = new TextDecoder();

export interface TarFile {
  path: string;
  data: Uint8Array;
}

export interface TarOptions {
  /** Whether to keep a regular file, from its path and size. Skipped files are never buffered. */
  want(path: string, size: number): boolean;
  onFile(file: TarFile): void;
}

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

function octal(bytes: Uint8Array): number {
  // Base-256 (high bit set) for sizes over 8 GiB; never kept, but parse it so the skip length is right.
  if (bytes[0] & 0x80) {
    let n = 0;
    for (let i = 1; i < bytes.length; i++) n = n * 256 + bytes[i];
    return n;
  }
  const text = cString(bytes).trim();
  return text ? Number.parseInt(text, 8) : 0;
}

/** pax records: "<length> <key>=<value>\n", repeated. */
export function parsePax(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const text = decoder.decode(data);
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    if (space === -1) break;
    const len = Number.parseInt(text.slice(i, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(space + 1, i + len - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

type Pending = { kind: 'file' | 'pax' | 'global' | 'longname'; path: string; size: number; keep: boolean };

export class TarStream {
  /** From the pax global header's `comment` (GitHub: the commit id). */
  comment: string | null = null;
  done = false;

  private buf = new Uint8Array(0);
  private entry: Pending | null = null;
  private remaining = 0; // data bytes of the current entry still to read
  private padding = 0; // zero bytes after the data, up to the next block
  private parts: Uint8Array[] = [];
  private nextPath: string | null = null; // from a pax 'x' header or a GNU 'L' entry
  private zeroBlocks = 0;

  constructor(private readonly opts: TarOptions) {}

  push(chunk: Uint8Array): void {
    let data = chunk;
    while (data.length > 0 && !this.done) {
      if (this.entry) {
        const take = Math.min(this.remaining, data.length);
        if (this.entry.keep && take > 0) this.parts.push(data.slice(0, take));
        this.remaining -= take;
        data = data.subarray(take);
        if (this.remaining === 0) this.finishEntry();
        continue;
      }
      if (this.padding > 0) {
        const skip = Math.min(this.padding, data.length);
        this.padding -= skip;
        data = data.subarray(skip);
        continue;
      }
      // Collect one header block.
      const need = BLOCK - this.buf.length;
      const take = Math.min(need, data.length);
      const merged = new Uint8Array(this.buf.length + take);
      merged.set(this.buf);
      merged.set(data.subarray(0, take), this.buf.length);
      this.buf = merged;
      data = data.subarray(take);
      if (this.buf.length === BLOCK) {
        const header = this.buf;
        this.buf = new Uint8Array(0);
        this.readHeader(header);
      }
    }
  }

  private readHeader(h: Uint8Array): void {
    if (h.every((b) => b === 0)) {
      if (++this.zeroBlocks >= 2) this.done = true;
      return;
    }
    this.zeroBlocks = 0;
    const name = cString(h.subarray(0, 100));
    const size = octal(h.subarray(124, 136));
    const type = String.fromCharCode(h[156] || 48); // '\0' is an old-style regular file
    const magic = cString(h.subarray(257, 263));
    const prefix = magic.startsWith('ustar') ? cString(h.subarray(345, 500)) : '';
    let path = prefix ? `${prefix}/${name}` : name;
    if (this.nextPath !== null && type !== 'x' && type !== 'L') {
      path = this.nextPath;
      this.nextPath = null;
    }

    let entry: Pending;
    if (type === 'x') entry = { kind: 'pax', path, size, keep: true };
    else if (type === 'g') entry = { kind: 'global', path, size, keep: true };
    else if (type === 'L') entry = { kind: 'longname', path, size, keep: true };
    else if (type === '0' || type === '7') entry = { kind: 'file', path, size, keep: this.opts.want(path, size) };
    else entry = { kind: 'file', path, size, keep: false }; // directories, links: nothing to read

    this.entry = entry;
    this.remaining = size;
    this.padding = (BLOCK - (size % BLOCK)) % BLOCK;
    this.parts = [];
    if (size === 0) this.finishEntry();
  }

  private finishEntry(): void {
    const entry = this.entry;
    this.entry = null;
    if (!entry || !entry.keep) return;
    const data = concat(this.parts);
    this.parts = [];
    if (entry.kind === 'pax') {
      const pax = parsePax(data);
      if (pax.path) this.nextPath = pax.path;
    } else if (entry.kind === 'global') {
      const pax = parsePax(data);
      if (pax.comment) this.comment = pax.comment;
    } else if (entry.kind === 'longname') {
      this.nextPath = cString(data);
    } else {
      this.opts.onFile({ path: entry.path, data });
    }
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
