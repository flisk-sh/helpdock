import { describe, expect, it } from 'vitest';
import { buildPrompt, chunkMarkdown, citedAnswer, cleanSnippet, extractiveAnswer, type SearchHit } from '../src/docs';

const hit = (n: number, extra: Partial<SearchHit> = {}): SearchHit => ({
  id: n,
  source: `page-${n}.md`,
  title: `Page ${n}`,
  section: `Section ${n}`,
  snippet: `text <b>${n}</b>`,
  rank: 1 / n,
  ...extra,
});

describe('chunkMarkdown', () => {
  it('splits on headings and takes the title from the first # heading', () => {
    const chunks = chunkMarkdown('setup.md', '# Setup\n\nIntro.\n\n## Install\n\nRun it.\n\n### Windows\n\nUse WSL2.');
    expect(chunks).toEqual([
      { source: 'setup.md', title: 'Setup', section: '', body: 'Intro.' },
      { source: 'setup.md', title: 'Setup', section: 'Install', body: 'Run it.' },
      { source: 'setup.md', title: 'Setup', section: 'Windows', body: 'Use WSL2.' },
    ]);
  });

  it('falls back to the file name when there is no # heading', () => {
    expect(chunkMarkdown('port-in-use.md', 'Stop the other process.')[0].title).toBe('port in use');
  });

  it('ignores headings inside fenced code', () => {
    const chunks = chunkMarkdown('a.md', '## Run\n\n```bash\n# not a heading\nflisk up\n```');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].body).toContain('# not a heading');
  });

  it('merges repeated headings so (source, section) stays unique', () => {
    const chunks = chunkMarkdown('a.md', '## Fix\n\none\n\n## Fix\n\ntwo');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].body).toBe('one\n\ntwo');
  });

  it('drops empty sections', () => {
    expect(chunkMarkdown('a.md', '# Title\n\n## Empty\n\n## Full\n\nbody').map((c) => c.section)).toEqual(['Full']);
  });
});

describe('answers', () => {
  it('cleanSnippet strips match markers and extra whitespace', () => {
    expect(cleanSnippet('run <b>flisk</b>\n\n  up')).toBe('run flisk up');
  });

  it('cleanSnippet drops code fences, table rules and bold markers', () => {
    expect(cleanSnippet('```text\nPort in use\n``` - **Cause:** another Tilt')).toBe('Port in use - Cause: another Tilt');
    expect(cleanSnippet('| Platform | `flisk up` |\n|----------|-----|\n| WSL2 | yes |')).toBe(
      'Platform · `flisk up` · WSL2 · yes',
    );
  });

  it('extractiveAnswer quotes the top three hits with citations', () => {
    const a = extractiveAnswer('q', [hit(1), hit(2), hit(3), hit(4)]);
    expect(a.reply).toContain('text 1 [1]');
    expect(a.reply).toContain('text 3 [3]');
    expect(a.sources.map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it('extractiveAnswer says so when nothing matches', () => {
    expect(extractiveAnswer('billing', [])).toEqual({
      reply: expect.stringContaining('"billing"'),
      sources: [],
    });
  });

  it('buildPrompt numbers the passages', () => {
    const { user } = buildPrompt('why?', [hit(1), hit(2, { section: '' })]);
    expect(user).toContain('[1] Page 1 > Section 1\ntext 1');
    expect(user).toContain('[2] Page 2\ntext 2');
    expect(user).toContain('Question: why?');
  });

  it('citedAnswer keeps only cited sources and renumbers them in order', () => {
    const a = citedAnswer('Use WSL2 [3]. Then run it [1][3]. Ignore [9].', [hit(1), hit(2), hit(3)]);
    expect(a.reply).toBe('Use WSL2 [1]. Then run it [2][1]. Ignore [9].');
    expect(a.sources.map((s) => [s.n, s.source])).toEqual([
      [1, 'page-3.md'],
      [2, 'page-1.md'],
    ]);
  });
});
