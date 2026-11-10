import { describe, expect, it } from 'vitest';
import type { RepoRead, RepoRef, RepoTree } from '../src/github';
import { RepoCache } from '../src/repos';

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
