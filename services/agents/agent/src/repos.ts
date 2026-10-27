// Help centers for public GitHub repositories, built on demand: /owner/repo reads the repository's Markdown from
// GitHub and indexes it in its own in-memory SQLite database. The URL is the whole state, so nothing needs saving: a
// restarted (or sleeping) instance rebuilds a repository on its next visit, in a few seconds.
import { fileUrl, MEMORY_LIMIT_MB, type RepoRef, RepoNotFound, readRepoDocs, rssMb } from './github';
import type { Stores } from './store';
import { createSqliteStores } from './store-sqlite';

export type RepoStatus = 'building' | 'ready' | 'error';

export interface RepoEntry {
  ref: RepoRef;
  key: string;
  status: RepoStatus;
  stores: Stores | null;
  sha: string | null;
  files: number;
  sections: number;
  bytes: number;
  truncated: boolean;
  /** While building: Markdown files found and archive bytes read so far. */
  progress: { files: number; archiveBytes: number };
  error: string | null;
  notFound: boolean;
  builtAt: number;
  usedAt: number;
  ready: Promise<RepoEntry>;
}

export interface RepoCacheOptions {
  /** Indexed text held in memory across repositories; the least recently used are dropped past it. */
  maxBytes: number;
  maxRepos: number;
  /** Builds at the same time; more answer "busy" until one finishes. */
  maxBuilds: number;
  /** A repository is read again from GitHub after this long. */
  ttlMs: number;
  read: typeof readRepoDocs;
  /** A partial build (a limit or the time ran out) is read again after this long, not after ttlMs. */
  partialTtlMs: number;
  now: () => number;
}

const DEFAULTS: RepoCacheOptions = {
  maxBytes: 48 * 1024 * 1024,
  maxRepos: 24,
  maxBuilds: Number(process.env.HELPDOCK_MAX_BUILDS || 2),
  ttlMs: 6 * 60 * 60 * 1000,
  read: readRepoDocs,
  partialTtlMs: 10 * 60 * 1000,
  now: Date.now,
};

export class BusyError extends Error {}

// Over the archive reader's 60 s limit with room for a CPU-starved instance to wind down and index what it read.
const BUILD_DEADLINE_MS = 180_000;

export function repoKey(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase();
}

export class RepoCache {
  private entries = new Map<string, RepoEntry>();
  private building = 0;
  private readonly opts: RepoCacheOptions;

  constructor(opts: Partial<RepoCacheOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** The entry when it exists (any status), without starting a build. */
  peek(ref: RepoRef): RepoEntry | undefined {
    return this.entries.get(repoKey(ref));
  }

  /**
   * The entry for a repository, starting a build when there is none or it is stale. Throws BusyError when a new build
   * would go over maxBuilds; `canBuild` lets the caller refuse a new build (a per-visitor limit) without refusing a
   * repository that is already built.
   */
  get(ref: RepoRef, canBuild: () => boolean = () => true): RepoEntry {
    const key = repoKey(ref);
    const now = this.opts.now();
    const existing = this.entries.get(key);
    const ttl = existing?.truncated ? this.opts.partialTtlMs : this.opts.ttlMs;
    if (existing && (existing.status === 'building' || now - existing.builtAt < ttl)) {
      existing.usedAt = now;
      // A failed build is retried after a minute, not on every request.
      if (existing.status !== 'error' || now - existing.builtAt < 60_000) return existing;
    }
    // No new build while memory is already high: evict first, and refuse if that was not enough.
    if (rssMb() > MEMORY_LIMIT_MB * 0.8) this.evict(true);
    if (this.building >= this.opts.maxBuilds || rssMb() > MEMORY_LIMIT_MB * 0.8) {
      if (existing?.status === 'ready') return existing; // stale but usable
      throw new BusyError('busy');
    }
    if (!canBuild()) {
      if (existing?.status === 'ready') return existing;
      throw new BusyError('limit');
    }
    return this.build(ref, key, existing);
  }

  stats() {
    let bytes = 0;
    for (const e of this.entries.values()) bytes += e.bytes;
    return { repos: this.entries.size, bytes, building: this.building };
  }

  private build(ref: RepoRef, key: string, previous: RepoEntry | undefined): RepoEntry {
    const now = this.opts.now();
    const entry: RepoEntry = {
      ref,
      key,
      status: 'building',
      stores: previous?.stores ?? null, // keep answering from the old index while the new one builds
      sha: previous?.sha ?? null,
      files: previous?.files ?? 0,
      sections: previous?.sections ?? 0,
      bytes: previous?.bytes ?? 0,
      truncated: previous?.truncated ?? false,
      progress: { files: 0, archiveBytes: 0 },
      error: null,
      notFound: false,
      builtAt: now,
      usedAt: now,
      ready: Promise.resolve(null as unknown as RepoEntry),
    };
    this.entries.set(key, entry);
    this.building++;
    entry.ready = (async () => {
      try {
        // A deadline over the reader's own limits: whatever happens inside, the build slot is freed.
        const read = await Promise.race([
          this.opts.read(ref, undefined, (p) => {
            entry.progress = p;
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('build deadline passed')), BUILD_DEADLINE_MS)),
        ]);
        if (read.files.length === 0) {
          entry.status = 'error';
          entry.error = 'This repository has no Markdown documentation to index.';
          return entry;
        }
        const stores = createSqliteStores(':memory:');
        let sections = 0;
        let bytes = 0;
        for (const f of read.files) {
          sections += await stores.docs.upsert(f.path, f.text);
          bytes += f.text.length;
        }
        await previous?.stores?.store.close();
        Object.assign(entry, {
          status: 'ready' as const,
          stores,
          sha: read.sha,
          // Pages with content: a file of only front matter or components indexes nothing.
          files: (await stores.docs.pages()).length,
          sections,
          bytes,
          truncated: read.truncated,
          builtAt: this.opts.now(),
        });
        const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
        console.log(`[repos] ${key}: ${read.files.length} files, ${sections} sections${read.truncated ? ' (truncated)' : ''}, rss ${rss} MB`);
        return entry;
      } catch (err) {
        entry.status = entry.stores ? 'ready' : 'error';
        entry.notFound = err instanceof RepoNotFound;
        entry.error = err instanceof RepoNotFound ? err.message : 'Could not read this repository from GitHub.';
        if (!(err instanceof RepoNotFound)) console.error(`[repos] ${key} failed:`, err);
        return entry;
      } finally {
        this.building--;
        this.evict();
      }
    })();
    return entry;
  }

  /** Drops least recently used repositories over the limits; with `memory`, also the oldest one under memory pressure. */
  private evict(memory = false) {
    const ready = [...this.entries.values()].filter((e) => e.status !== 'building').sort((a, b) => a.usedAt - b.usedAt);
    let { bytes } = this.stats();
    let count = this.entries.size;
    let freeOne = memory;
    for (const e of ready) {
      if (!freeOne && bytes <= this.opts.maxBytes && count <= this.opts.maxRepos) break;
      freeOne = false;
      this.entries.delete(e.key);
      void e.stores?.store.close();
      bytes -= e.bytes;
      count--;
    }
  }
}

/** Where a hit lives on GitHub: the file at the indexed commit, at the section's heading. */
export function repoLink(entry: RepoEntry) {
  return (hit: { source: string; section: string }) => fileUrl(entry.ref, entry.sha, hit.source, hit.section);
}
