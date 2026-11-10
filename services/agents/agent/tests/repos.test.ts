import { describe, expect, it } from 'vitest';
import type { RepoRead, RepoRef, RepoTree } from '../src/github';
import { RepoCache, type RepoEntry } from '../src/repos';

const ref: RepoRef = { owner: 'o', repo: 'r', scope: 'docs', branch: 'main' };
const files: Record<string, string> = {
  'docs/README.md': '# Product docs\n\nWelcome.',
  'docs/quickstart.md': '# Quickstart guide\n\nInstall it.',
  'docs/ci.md': '# Running in CI\n\nThe workflow.',
  'docs/internal/notes.md': '# Internal notes\n\nNot for users; workflow.',
};

function cache(config: string | null) {
  const list = async (): Promise<RepoTree> => ({ sha: 'abc', paths: Object.keys(files).map((path) => ({ path, size: 10 })), truncated: false });
  const read = async (): Promise<RepoRead> => ({ files: Object.entries(files).map(([path, text]) => ({ path, text })), sha: 'abc', truncated: false, archiveBytes: 0 });
  return new RepoCache({ list, read, config: async () => config });
}

const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);

/** A repository whose branch head and .helpdock.json the test moves, on a clock the test moves. */
function movingRepo() {
  const state = { head: SHA1, config: null as string | null, now: 1_000_000, lists: 0, heads: 0 };
  const list = async (): Promise<RepoTree> => {
    state.lists++;
    return { sha: state.head, paths: Object.keys(files).map((path) => ({ path, size: 10 })), truncated: false };
  };
  const read = async (): Promise<RepoRead> => ({ files: Object.entries(files).map(([path, text]) => ({ path, text })), sha: state.head, truncated: false, archiveBytes: 0 });
  const repos = new RepoCache({
    list,
    read,
    config: async () => state.config,
    head: async () => {
      state.heads++;
      return state.head;
    },
    headCheckMs: 180_000,
    now: () => state.now,
  });
  return { state, repos };
}

describe('RepoCache with .helpdock.json', () => {
  it('leaves excluded pages out of the listing and the search index, and keeps groups and start pages', async () => {
    const repos = cache(JSON.stringify({ exclude: ['internal/**'], groups: [{ name: 'Get started', pages: ['quickstart.md', 'README.md'] }], start: ['quickstart.md'] }));
    const entry = await repos.get(ref).ready;
    expect(entry.paths.map((p) => p.path)).toEqual(['docs/README.md', 'docs/quickstart.md', 'docs/ci.md']);
    expect(entry.groups).toEqual(['Get started']);
    expect(entry.start).toEqual(['docs/quickstart.md']);
    expect(entry.placement.get('docs/quickstart.md')).toEqual({ group: 0, order: 0 });
    const hits = await entry.stores?.docs.search('workflow', 10);
    expect(hits?.map((h) => h.source)).toEqual(['docs/ci.md']);
  });

  it('lists every page without a config', async () => {
    const entry = await cache(null).get(ref).ready;
    expect(entry.paths).toHaveLength(4);
    expect(entry.groups).toEqual([]);
  });

  it('keeps the titles the index found once the index is gone', async () => {
    const repos = cache(null);
    const entry = await repos.get(ref).ready;
    const docs = entry.stores!.docs;
    // Before any index: titles from file names.
    expect((await docs.pages()).find((p) => p.source === 'docs/ci.md')?.title).toBe('Ci');
    await docs.search('workflow', 5); // builds the index
    expect((await docs.pages()).find((p) => p.source === 'docs/ci.md')?.title).toBe('Running in CI');
    entry.index = null; // dropped after being idle
    const page = (await docs.pages()).find((p) => p.source === 'docs/ci.md');
    expect(page?.title).toBe('Running in CI');
    expect(page?.lead).toContain('The workflow.');
  });
});

describe('RepoCache follows new commits', () => {
  it('lists the repository again within minutes of a push, not after the six-hour ttl', async () => {
    const { state, repos } = movingRepo();
    const first = await repos.get(ref).ready;
    expect(first.sha).toBe(SHA1);
    expect(first.groups).toEqual([]);

    // A push adds a .helpdock.json. Within the check interval nothing is asked of GitHub.
    state.head = SHA2;
    state.config = JSON.stringify({ groups: [{ name: 'Get started', pages: ['quickstart.md'] }] });
    state.now += 60_000;
    await repos.checkHead(repos.get(ref));
    expect(state.heads).toBe(0);
    expect(repos.peek(ref)?.sha).toBe(SHA1);

    // Past it, one visit compares the head, sees the new commit and lists again.
    state.now += 180_000;
    await repos.checkHead(repos.get(ref));
    expect(state.heads).toBe(1);
    const second = await (repos.peek(ref) as RepoEntry).ready;
    expect(second.sha).toBe(SHA2);
    expect(second.groups).toEqual(['Get started']);
    expect(state.lists).toBe(2);
  });

  it('asks for the head once per interval however many visits come, and lists nothing when it did not move', async () => {
    const { state, repos } = movingRepo();
    await repos.get(ref).ready;
    state.now += 200_000;
    await Promise.all([repos.checkHead(repos.get(ref)), repos.checkHead(repos.get(ref)), repos.checkHead(repos.get(ref))]);
    expect(state.heads).toBe(1);
    expect(state.lists).toBe(1);
    expect(repos.peek(ref)?.status).toBe('ready');
  });

  it('drops the search index of the old commit, so answers come from the new pages', async () => {
    const { state, repos } = movingRepo();
    const first = await repos.get(ref).ready;
    await first.stores?.docs.search('workflow', 5);
    expect(first.indexed).toBe(true);
    state.head = SHA2;
    state.now += 200_000;
    await repos.checkHead(repos.get(ref));
    const second = await (repos.peek(ref) as RepoEntry).ready;
    expect(second.sha).toBe(SHA2);
    expect(second.index).toBeNull();
    expect(second.indexed).toBe(false);
  });

  it('never checks a listing without a known commit (the archive fallback says HEAD)', async () => {
    let heads = 0;
    const repos = new RepoCache({
      list: async () => ({ sha: 'HEAD', paths: [{ path: 'docs/README.md', size: 10 }], truncated: false }),
      read: async () => ({ files: [], sha: 'HEAD', truncated: false, archiveBytes: 0 }),
      config: async () => null,
      head: async () => {
        heads++;
        return SHA2;
      },
      headCheckMs: 0,
    });
    await repos.get(ref).ready;
    await repos.checkHead(repos.get(ref));
    expect(heads).toBe(0);
  });
});
