import { describe, expect, it } from 'vitest';
import { applyConfig, globToRegExp, parseConfig } from '../src/config';

const listing = (...paths: string[]) => paths.map((path) => ({ path, size: 1 }));

describe('parseConfig', () => {
  it('reads include, exclude, groups and start, and ignores what it does not know', () => {
    const c = parseConfig(
      JSON.stringify({
        include: ['**'],
        exclude: ['./drafts/**', 42, ''],
        groups: [{ name: 'Get started', pages: ['quickstart.md'] }, { name: 'Empty', pages: [] }, { pages: ['x.md'] }],
        start: ['/quickstart.md'],
        other: true,
      }),
    );
    expect(c).toEqual({ include: ['**'], exclude: ['drafts/**'], groups: [{ name: 'Get started', pages: ['quickstart.md'] }], start: ['quickstart.md'] });
  });

  it('is null for no file, broken JSON or a non-object', () => {
    expect(parseConfig(null)).toBeNull();
    expect(parseConfig('{ nope')).toBeNull();
    expect(parseConfig('[1, 2]')).toBeNull();
  });
});

describe('globToRegExp', () => {
  it('matches * within a folder, ** across folders, and a folder name as its contents', () => {
    expect(globToRegExp('*.md').test('ci.md')).toBe(true);
    expect(globToRegExp('*.md').test('fit/a.md')).toBe(false);
    expect(globToRegExp('fit/**').test('fit/a/b.md')).toBe(true);
    expect(globToRegExp('**/notes.md').test('notes.md')).toBe(true);
    expect(globToRegExp('**/notes.md').test('a/b/notes.md')).toBe(true);
    expect(globToRegExp('drafts').test('drafts/show-hn.md')).toBe(true);
    expect(globToRegExp('drafts/').test('drafts/show-hn.md')).toBe(true);
    expect(globToRegExp('README-??.md').test('README-de.md')).toBe(true);
    expect(globToRegExp('a.md').test('a-md')).toBe(false);
  });
});

describe('applyConfig', () => {
  const paths = listing('docs/README.md', 'docs/quickstart.md', 'docs/ci.md', 'docs/install/npm.md', 'docs/install/bun.md', 'docs/fit/a.md', 'docs/marketing/post.md');

  it('changes nothing without a config', () => {
    const out = applyConfig(paths, null, 'docs');
    expect(out.paths).toBe(paths);
    expect(out.groups).toEqual([]);
    expect(out.start).toEqual([]);
  });

  it('keeps what include matches minus exclude, relative to the scope folder', () => {
    const out = applyConfig(paths, parseConfig(JSON.stringify({ include: ['*.md', 'install/**', 'fit/**'], exclude: ['fit'] })), 'docs');
    expect(out.paths.map((p) => p.path)).toEqual(['docs/README.md', 'docs/quickstart.md', 'docs/ci.md', 'docs/install/npm.md', 'docs/install/bun.md']);
  });

  it('places pages in the first matching group, by the first glob they match, then by path', () => {
    const config = parseConfig(
      JSON.stringify({
        exclude: ['marketing/**'],
        groups: [
          { name: 'Get started', pages: ['quickstart.md', 'install/*.md'] },
          { name: 'Guides', pages: ['*.md', 'install/**'] },
        ],
      }),
    );
    const out = applyConfig(paths, config, 'docs');
    expect(out.groups).toEqual(['Get started', 'Guides']);
    const placed = [...out.placement.entries()].sort((a, b) => a[1].order - b[1].order).map(([p, v]) => `${v.group}:${p}`);
    expect(placed).toEqual(['0:docs/quickstart.md', '0:docs/install/bun.md', '0:docs/install/npm.md', '1:docs/ci.md', '1:docs/README.md']);
    expect(out.placement.has('docs/fit/a.md')).toBe(false); // in no group: listed after the groups
    // Without "start", the first group's pages are the "Start here" pages.
    expect(out.start).toEqual(['docs/quickstart.md', 'docs/install/bun.md', 'docs/install/npm.md']);
  });

  it('keeps the start pages that exist, in the given order', () => {
    const out = applyConfig(paths, parseConfig(JSON.stringify({ start: ['ci.md', 'missing.md', 'quickstart.md', 'ci.md'] })), 'docs');
    expect(out.start).toEqual(['docs/ci.md', 'docs/quickstart.md']);
  });

  it('works on a whole repository (no scope)', () => {
    const out = applyConfig(listing('README.md', 'docs/a.md', 'notes/b.md'), parseConfig('{"exclude":["notes/**"]}'));
    expect(out.paths.map((p) => p.path)).toEqual(['README.md', 'docs/a.md']);
  });
});
