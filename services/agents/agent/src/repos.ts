// Help centers for public GitHub repositories, built on demand: /owner/repo shows the repository's documentation as a
// table of contents and a README, and nothing more is held for it. The URL is the whole state, so nothing needs saving:
// a restarted (or sleeping) instance lists a repository again on its next visit, in about two seconds.
//
//   tree     the list of documentation files (paths only, a few KB), read with `git ls-tree` on a no-blob clone;
//            every page is fetched from raw.githubusercontent.com when someone opens it
//   index    SQLite full-text search over the pages' text, built only when someone asks a question or calls the MCP
//            for that repository, and dropped after it has been idle for ten minutes (memory follows use, not the
//            number of repositories opened)
import { chunkMarkdown, type SearchHit, summarize, titleFromPath } from './docs';
import {
  docPriority,
  fetchRaw,
  fileUrl,
  listRepoDocs,
  MEMORY_LIMIT_MB,
  type RepoRef,
  RepoNotFound,
  type RepoTree,
  readRepoDocs,
  rssMb,
} from './github';
import type { Checkpoint, DocStore, SessionStore, Stores } from './store';
import { createSqliteStores } from './store-sqlite';

export type RepoStatus = 'building' | 'ready' | 'error';

interface RepoIndex {
  stores: Stores;
  /** Resolves when the first batch is in, so search can start while the rest is added. */
  opened: Promise<void>;
  /** Resolves when every page is in (or the build failed or was dropped). */
  done: Promise<void>;
  sections: number;
  bytes: number;
  /** Still adding pages after it opened. */
  adding: boolean;
  usedAt: number;
}

export interface RepoEntry {
  ref: RepoRef;
  key: string;
  status: RepoStatus;
  /** Set when the tree is listed: lazy docs (tree, pages on demand, index on first search) and per-repo sessions. */
  stores: Stores | null;
  sha: string | null;
  /** The documentation files shown in the table of contents. */
  paths: Array<{ path: string; size: number }>;
  files: number;
  /** Sections in the search index, 0 while there is none. */
  sections: number;
  /** Bytes of indexed text. */
  bytes: number;
  truncated: boolean;
  /** Waiting for a slot; it starts when one frees (never refused as busy). */
  queued: boolean;
  /** A search index exists (building or built). */
  indexed: boolean;
  /** The index is open for search and still adding pages. */
  indexing: boolean;
  progress: { files: number; archiveBytes: number };
  error: string | null;
  notFound: boolean;
  builtAt: number;
  usedAt: number;
  index: RepoIndex | null;
  ready: Promise<RepoEntry>;
}

export interface RepoCacheOptions {
  maxRepos: number;
  /** Indexed text held in memory across repositories; the least recently used indexes are dropped past it. */
  maxBytes: number;
  /** Tree listings and index builds at the same time; more wait in a queue. */
  maxBuilds: number;
  /** A repository's tree is listed again after this long. */
  ttlMs: number;
  /** A partial tree (a limit was hit) is listed again after this long, not after ttlMs. */
  partialTtlMs: number;
  /** An index nobody searched for this long is dropped. */
  indexIdleMs: number;
  list: typeof listRepoDocs;
  read: typeof readRepoDocs;
  now: () => number;
}

const DEFAULTS: RepoCacheOptions = {
  maxRepos: 40,
  maxBytes: 48 * 1024 * 1024,
  maxBuilds: Number(process.env.HELPDOCK_MAX_BUILDS || 2),
  ttlMs: 6 * 60 * 60 * 1000,
  partialTtlMs: 10 * 60 * 1000,
  indexIdleMs: Number(process.env.HELPDOCK_INDEX_IDLE_MS || 10 * 60 * 1000),
  list: listRepoDocs,
  read: readRepoDocs,
  now: Date.now,
};

export class BusyError extends Error {}
/** Search was asked for before the index could open. The caller answers 503 and the client asks again. */
export class IndexNotReady extends Error {}

// Over the readers' own limits, with room for a CPU-starved instance to wind down.
const BUILD_DEADLINE_MS = 180_000;
const INDEX_WAIT_MS = 80_000;
// How long a question waits for the rest of a building index before answering from what is in it.
const COMPLETE_WAIT_MS = 20_000;
// A queued job waits while the process is over this share of HELPDOCK_MEMORY_MB, dropping idle indexes meanwhile.
const QUEUE_MEMORY_FACTOR = 1.3;
const INDEX_BATCH = 50;

export function repoKey(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase();
}

// Chat sessions of every repository share one small in-memory store, keyed by repository and session id.
const sessions = createSqliteStores(':memory:').store;
function sessionsFor(key: string): SessionStore {
  const scoped = (id: string) => `${key}~${id}`;
  return {
    kind: 'sqlite',
    ready: () => sessions.ready(),
    async load(id: string): Promise<Checkpoint> {
      const found = await sessions.load(scoped(id));
      return { sessionId: id, messages: found.messages };
    },
    save: (c: Checkpoint) => sessions.save({ ...c, sessionId: scoped(c.sessionId) }),
    close: async () => {},
  };
}

function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('deadline passed')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export class RepoCache {
  private entries = new Map<string, RepoEntry>();
  private building = 0;
  private queue: Array<() => void> = [];
  private readonly opts: RepoCacheOptions;

  constructor(opts: Partial<RepoCacheOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    const sweep = setInterval(() => this.sweep(), 60_000);
    (sweep as unknown as { unref?: () => void }).unref?.();
  }

  /** The entry when it exists (any status), without starting a build. */
  peek(ref: RepoRef): RepoEntry | undefined {
    return this.entries.get(repoKey(ref));
  }

  /**
   * The entry for a repository, listing its tree when there is none or it is stale. A listing that cannot start now
   * waits in a queue and starts when a slot frees, so a visitor is never refused as busy. `canBuild` lets the caller
   * refuse a new repository (a per-visitor limit) without refusing one already listed: that throws BusyError('limit').
   */
  get(ref: RepoRef, canBuild: () => boolean = () => true): RepoEntry {
    const key = repoKey(ref);
    const now = this.opts.now();
    const existing = this.entries.get(key);
    const ttl = existing?.truncated ? this.opts.partialTtlMs : this.opts.ttlMs;
    if (existing && (existing.status === 'building' || now - existing.builtAt < ttl)) {
      existing.usedAt = now;
      // A failed listing is retried after a minute, not on every request.
      if (existing.status !== 'error' || now - existing.builtAt < 60_000) return existing;
    }
    if (!canBuild()) {
      if (existing?.status === 'ready') return existing;
      throw new BusyError('limit');
    }
    return this.build(ref, key, existing);
  }

  stats() {
    let bytes = 0;
    let indexes = 0;
    for (const e of this.entries.values()) {
      bytes += e.bytes;
      if (e.index) indexes++;
    }
    return { repos: this.entries.size, indexes, bytes, building: this.building, queued: this.queue.length };
  }

  /** Builds the repository's search index if it has none; resolves when search can start (first batch in). */
  async ensureIndex(entry: RepoEntry): Promise<void> {
    await entry.ready;
    if (entry.status !== 'ready') throw new IndexNotReady(entry.error ?? 'repository not available');
    const now = this.opts.now();
    entry.usedAt = now;
    if (!entry.index) this.startIndex(entry);
    const index = entry.index as RepoIndex;
    index.usedAt = now;
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      index.opened,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new IndexNotReady('still indexing')), INDEX_WAIT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  /** Runs `job` when a slot is free. */
  private schedule<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.building++;
        job()
          .then(resolve, reject)
          .finally(() => {
            this.building--;
            this.evict();
            this.pump();
          });
      });
      this.pump();
    });
  }

  /** Starts queued jobs while slots are free. Under memory pressure it drops idle indexes, then tries again shortly. */
  private pump() {
    while (this.queue.length > 0 && this.building < this.opts.maxBuilds) {
      if (rssMb() > MEMORY_LIMIT_MB * QUEUE_MEMORY_FACTOR) {
        this.evict(true);
        setTimeout(() => this.pump(), 3000);
        return;
      }
      this.queue.shift()?.();
    }
  }

  private build(ref: RepoRef, key: string, previous: RepoEntry | undefined): RepoEntry {
    const now = this.opts.now();
    const entry: RepoEntry = {
      ref,
      key,
      status: 'building',
      stores: previous?.stores ?? null,
      sha: previous?.sha ?? null,
      paths: previous?.paths ?? [],
      files: previous?.files ?? 0,
      sections: previous?.sections ?? 0,
      bytes: previous?.bytes ?? 0,
      truncated: previous?.truncated ?? false,
      queued: true,
      indexed: previous?.indexed ?? false,
      indexing: previous?.indexing ?? false,
      progress: { files: 0, archiveBytes: 0 },
      error: null,
      notFound: false,
      builtAt: now,
      usedAt: now,
      index: previous?.index ?? null, // a fresh listing keeps the index it replaces; it is searched until dropped
      ready: Promise.resolve(null as unknown as RepoEntry),
    };
    this.entries.set(key, entry);
    entry.ready = this.schedule(async () => {
      entry.queued = false;
      try {
        const tree = await deadline(this.listTree(ref, entry), BUILD_DEADLINE_MS);
        if (tree.paths.length === 0) {
          entry.status = 'error';
          entry.error = 'This repository has no Markdown documentation.';
          return entry;
        }
        Object.assign(entry, {
          status: 'ready' as const,
          sha: tree.sha,
          paths: tree.paths,
          files: tree.paths.length,
          truncated: tree.truncated,
          stores: { store: sessionsFor(key), docs: this.lazyDocs(entry) },
          builtAt: this.opts.now(),
        });
        console.log(`[repos] ${key}: ${tree.paths.length} docs listed${tree.truncated ? ' (truncated)' : ''}, rss ${Math.round(rssMb())} MB`);
        return entry;
      } catch (err) {
        entry.status = entry.stores ? 'ready' : 'error';
        entry.notFound = err instanceof RepoNotFound;
        entry.error = err instanceof RepoNotFound ? err.message : 'Could not read this repository from GitHub.';
        if (!(err instanceof RepoNotFound)) console.error(`[repos] ${key} failed:`, err);
        return entry;
      }
    });
    return entry;
  }

  /** The tree through git; when git fails, through the API or the archive (more work, same result). */
  private async listTree(ref: RepoRef, entry: RepoEntry): Promise<RepoTree> {
    try {
      return await this.opts.list(ref);
    } catch (err) {
      if (err instanceof RepoNotFound) throw err;
      console.warn(`[repos] ${entry.key}: git listing failed (${(err as Error).message.split('\n')[0]}); reading files instead`);
      const read = await this.opts.read(ref, undefined, (p) => {
        entry.progress = p;
      });
      return {
        sha: read.sha ?? 'HEAD',
        paths: read.files.map((f) => ({ path: f.path, size: f.text.length })),
        truncated: read.truncated,
      };
    }
  }

  /** Reads the pages and fills the repository's index, best pages first; see ensureIndex. */
  private startIndex(entry: RepoEntry) {
    let open!: () => void;
    let fail!: (err: unknown) => void;
    const opened = new Promise<void>((resolve, reject) => {
      open = resolve;
      fail = reject;
    });
    opened.catch(() => {}); // a failure is reported to whoever awaits ensureIndex
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const index: RepoIndex = {
      stores: createSqliteStores(':memory:'),
      opened,
      done,
      sections: 0,
      bytes: 0,
      adding: true,
      usedAt: this.opts.now(),
    };
    entry.index = index;
    entry.indexed = true;
    entry.indexing = true;
    void this.schedule(async () => {
      try {
        const read = await deadline(this.opts.read(entry.ref), BUILD_DEADLINE_MS);
        const order = [...read.files].sort((a, b) => docPriority(b.path) - docPriority(a.path) || a.path.localeCompare(b.path));
        for (let start = 0; start < order.length; start += INDEX_BATCH) {
          if (entry.index !== index) return; // dropped while building
          const batch = order.slice(start, start + INDEX_BATCH);
          index.sections += await index.stores.docs.upsertMany(batch.map((f) => ({ source: f.path, markdown: f.text })));
          index.bytes += batch.reduce((n, f) => n + f.text.length, 0);
          Object.assign(entry, { sections: index.sections, bytes: index.bytes });
          if (start === 0) open();
          await new Promise((r) => setImmediate(r));
        }
        open(); // an empty repository opens an empty index
        console.log(`[repos] ${entry.key}: indexed ${order.length} files, ${index.sections} sections, rss ${Math.round(rssMb())} MB`);
      } catch (err) {
        console.error(`[repos] ${entry.key} index failed:`, err);
        fail(new IndexNotReady('could not index this repository'));
        this.dropIndex(entry);
      } finally {
        index.adding = false;
        if (entry.index === index) entry.indexing = false;
        finish();
      }
    }).catch(() => {});
  }

  /** The repository as a DocStore: pages from the tree and GitHub, search through the index (built on first use). */
  private lazyDocs(entry: RepoEntry): DocStore {
    const cache = this;
    const indexed = () => (entry.index && !entry.index.adding ? entry.index.stores.docs : null);
    return {
      async search(query: string, limit = 5): Promise<SearchHit[]> {
        await cache.ensureIndex(entry);
        const index = entry.index;
        if (!index) throw new IndexNotReady('index was dropped');
        // Answering from the first batch alone ranks wrongly (a page named after the topic may not be in it yet): the
        // first question waits for the whole index, for a few seconds at most, then answers with what is there.
        if (index.adding) {
          let timer: ReturnType<typeof setTimeout>;
          await Promise.race([index.done, new Promise((r) => (timer = setTimeout(r, COMPLETE_WAIT_MS)))]).finally(() => clearTimeout(timer));
        }
        if (entry.index !== index) throw new IndexNotReady('index was dropped');
        index.usedAt = cache.opts.now();
        return index.stores.docs.search(query, limit);
      },
      async upsert() {
        throw new Error('repository help centers are read-only');
      },
      async upsertMany() {
        throw new Error('repository help centers are read-only');
      },
      // The number of pages in the table of contents; it does not change when an index comes and goes.
      async count() {
        return entry.paths.length;
      },
      async pages() {
        const full = indexed();
        if (full) return full.pages();
        return entry.paths.map((p) => ({ source: p.path, title: titleFromPath(p.path), sections: 0, lead: '' }));
      },
      async page(source: string) {
        const full = indexed();
        const known = full ? await full.page(source) : null;
        if (known) return known;
        if (!entry.paths.some((p) => p.path === source) || !entry.sha) return null;
        const text = await fetchRaw(entry.ref, entry.sha, source);
        if (text === null) return null;
        const chunks = chunkMarkdown(source, text);
        if (chunks.length === 0) return null;
        return { source, title: chunks[0].title, sections: chunks.map((c) => ({ section: c.section, body: c.body })) };
      },
    };
  }

  private dropIndex(entry: RepoEntry) {
    const index = entry.index;
    if (!index) return;
    entry.index = null;
    Object.assign(entry, { indexed: false, indexing: false, sections: 0, bytes: 0 });
    void index.stores.store.close();
  }

  /** Drops indexes nobody searched for lately. */
  private sweep() {
    const now = this.opts.now();
    for (const e of this.entries.values()) {
      if (e.index && !e.index.adding && now - e.index.usedAt > this.opts.indexIdleMs) this.dropIndex(e);
    }
  }

  /**
   * Drops what is over the limits: indexes first (least recently searched), then least recently used repositories;
   * with `memory`, at least one thing, for memory pressure.
   */
  private evict(memory = false) {
    let { bytes } = this.stats();
    let freeOne = memory;
    const byIndexUse = [...this.entries.values()]
      .filter((e) => e.index && !e.index.adding)
      .sort((a, b) => (a.index?.usedAt ?? 0) - (b.index?.usedAt ?? 0));
    for (const e of byIndexUse) {
      if (!freeOne && bytes <= this.opts.maxBytes) break;
      freeOne = false;
      bytes -= e.bytes;
      this.dropIndex(e);
    }
    const byUse = [...this.entries.values()].filter((e) => e.status !== 'building').sort((a, b) => a.usedAt - b.usedAt);
    let count = this.entries.size;
    for (const e of byUse) {
      if (count <= this.opts.maxRepos) break;
      this.dropIndex(e);
      this.entries.delete(e.key);
      count--;
    }
  }
}

/** Where a hit lives on GitHub: the file at the listed commit, at the section's heading. */
export function repoLink(entry: RepoEntry) {
  return (hit: { source: string; section: string }) => fileUrl(entry.ref, entry.sha, hit.source, hit.section);
}

/** A page's lead sentence, for the "Start here" cards. */
export function leadOf(page: { sections: Array<{ body: string }> }): string {
  return summarize(page.sections[0]?.body ?? '');
}
