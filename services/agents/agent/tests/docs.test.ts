import { describe, expect, it } from 'vitest';
import { aiPrompt, chunkMarkdown, cleanHeading, cleanSnippet, dedupeHits, fileWords, nameBoost, summarize, excerpt, extractiveAnswer, ftsQuery, queryWords, type SearchHit, toSources } from '../src/docs';

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
    expect(chunkMarkdown('port-in-use.md', 'Stop the other process.')[0].title).toBe('Port in use');
    expect(chunkMarkdown('docs/getting-started/index.md', 'x')[0].title).toBe('Getting started');
    expect(chunkMarkdown('docs/01-app/01-getting-started/01-installation.mdx', 'x')[0].title).toBe('Installation');
    expect(chunkMarkdown('docs/01-app/index.mdx', 'x')[0].title).toBe('App');
    expect(chunkMarkdown('a.md', '```py\n# not a title\n```\n\n# Real title\n\nx')[0].title).toBe('Real title');
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

  it('extractiveAnswer cites the top three hits, with excerpts and links', () => {
    const a = extractiveAnswer('q', [hit(1), hit(2, { body: 'Body two.' }), hit(3), hit(4)], (h) => `https://x/${h.source}`);
    expect(a.sources.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(a.sources[0].excerpt).toBe('text 1'); // no body: the cleaned snippet
    expect(a.sources[1].excerpt).toBe('Body two.');
    expect(a.sources[2].url).toBe('https://x/page-3.md');
    expect(a.reply).toContain('[2] Page 2 › Section 2\nBody two.');
  });

  it('extractiveAnswer says so when nothing matches', () => {
    expect(extractiveAnswer('billing', [])).toEqual({
      reply: expect.stringContaining('"billing"'),
      sources: [],
    });
  });

  it('aiPrompt carries the question and the numbered passages, with links when known', () => {
    const sources = toSources('why?', [hit(1), hit(2, { section: '' })], (h) => (h.id === 1 ? 'https://gh/p1' : undefined));
    const p = aiPrompt('why?', sources, 'https://helpdock.flisk.sh/');
    expect(p).toContain('help center at https://helpdock.flisk.sh/');
    expect(p).toContain('Question: why?');
    expect(p).toContain('[1] Page 1 › Section 1 (https://gh/p1)\ntext 1');
    expect(p).toContain('[2] Page 2 (page-2.md)\ntext 2');
  });

  it('aiPrompt stays short enough for a prefill URL', () => {
    const long = hit(1, { snippet: 'x'.repeat(5000) });
    const p = aiPrompt('q', toSources('q', [long, hit(2, { snippet: 'y'.repeat(5000) })]), 'https://h');
    expect(p.length).toBeLessThanOrEqual(6000);
    expect(p).toContain('[1]');
    expect(p).not.toContain('[2]');
    expect(aiPrompt('q', [], 'https://h')).toContain('(no matching passages)');
  });
});

describe('ftsQuery', () => {
  it('keeps the meaningful words, quoted and OR-ed', () => {
    expect(ftsQuery('How do I run Flisk on Windows?')).toBe('"run" OR "flisk" OR "windows"');
  });

  it('never passes FTS5 syntax through and drops duplicates', () => {
    expect(ftsQuery('ports NEAR(ports "x") OR -tilt*')).toBe('"ports" OR "near" OR "tilt"');
  });

  it('is null when only stop words are left', () => {
    expect(ftsQuery('how do I?')).toBeNull();
    expect(ftsQuery('   ')).toBeNull();
  });
});

describe('cleanHeading', () => {
  it('reduces links, emphasis and attribute lists to text', () => {
    expect(cleanHeading('[uv-installer](./uv-installer)')).toBe('uv-installer');
    expect(cleanHeading('**Install** it {#install}')).toBe('Install it');
    expect(cleanHeading('Dependency Injection { #dependency-injection }')).toBe('Dependency Injection');
    expect(cleanHeading('The [API][api] ##')).toBe('The API');
  });
});

describe('excerpt', () => {
  it('takes the start of a long block after a one-line lead-in', () => {
    const code = '```sh\n' + Array.from({ length: 80 }, (_, i) => `echo line ${i}`).join('\n') + '\n```';
    const e = excerpt(`Install uv with the installer.\n\n${code}`, 'install uv');
    expect(e.startsWith('Install uv with the installer.\n\n```sh\necho line 0')).toBe(true);
    expect(e.endsWith('…\n```')).toBe(true);
    expect(e.length).toBeLessThan(1200);
  });

  const body = [
    'uv is fast.',
    'To install it, run the installer:',
    '```sh\ncurl -LsSf https://astral.sh/uv/install.sh | sh\n```',
    'Then check the version.',
    'Unrelated closing words.',
  ].join('\n\n');

  it('starts at the block that matches the question, with its lead-in for a code block', () => {
    const e = excerpt(body, 'how do I install uv with curl');
    expect(e.startsWith('To install it, run the installer:')).toBe(true);
    expect(e).toContain('```sh\ncurl -LsSf');
  });

  it('matches longer words by their first letters', () => {
    expect(excerpt('Alpha.\n\nInstalling takes a minute.', 'installation')).toBe('Installing takes a minute.');
  });

  it('stays under the size, cutting a long first block at a sentence', () => {
    const long = 'First sentence here. '.repeat(80);
    const e = excerpt(long, 'sentence', 200);
    expect(e.length).toBeLessThanOrEqual(202);
    expect(e.endsWith('. …') || e.endsWith('…')).toBe(true);
    expect(excerpt('', 'x')).toBe('');
  });

  it('keeps a code block whole', () => {
    expect(excerpt('```\na\nb\n```', 'a')).toBe('```\na\nb\n```');
  });

  it('queryWords drops stop words and duplicates', () => {
    expect(queryWords('How do I install, install UV?')).toEqual(['install', 'uv']);
  });
});

describe('dedupeHits', () => {
  it('keeps one hit per title and section, the newest of equal copies, in the first one\'s place', () => {
    const v = (source: string, rank: number, section = 'Sampling') => hit(1, { source, rank, title: 'Spec', section });
    const out = dedupeHits([v('spec/2025-03-26/s.md', 5), hit(9, { title: 'Other', section: 'x', rank: 4 }), v('spec/2025-11-25/s.md', 5), v('spec/2024-11-05/s.md', 4.99)]);
    expect(out.map((h) => [h.title, h.source])).toEqual([
      ['Spec', 'spec/2025-11-25/s.md'],
      ['Other', 'page-9.md'],
    ]);
  });

  it('keeps a clearly better ranked copy even if its path is older', () => {
    const out = dedupeHits([hit(1, { title: 'T', section: 'S', source: 'a/old.md', rank: 10 }), hit(2, { title: 'T', section: 'S', source: 'b/new.md', rank: 5 })]);
    expect(out.map((h) => h.source)).toEqual(['a/old.md']);
  });
});

describe('summarize', () => {
  it('takes the first real paragraph as plain text', () => {
    expect(summarize('```sh\nnpm i\n```\n\nUse the [App Router](./app.md) to build **fast** apps with `next`.\n\nMore.')).toBe(
      'Use the App Router to build fast apps with next.',
    );
  });

  it('cuts at a sentence or a word', () => {
    expect(summarize('One two three. Four five six seven eight nine ten.', 20)).toBe('One two three.');
    expect(summarize('Alpha beta gamma delta epsilon zeta', 20)).toBe('Alpha beta gamma…');
    expect(summarize('| a | b |\n|---|---|')).toBe('');
  });
});

describe('nameBoost', () => {
  const page = (source: string, title = '', section = '') => ({ source, title, section });

  it('reads the words a file is named by', () => {
    expect(fileWords('docs/01-app/03-file-conventions/middleware.mdx')).toEqual(['middleware']);
    expect(fileWords('docs/01-app/02-guides/environment-variables.mdx')).toEqual(['environment', 'variables']);
    expect(fileWords('docs/getting-started/index.md')).toEqual(['getting', 'started']);
  });

  it('ranks the page named after the question above others', () => {
    const q = 'How do I add middleware?';
    expect(nameBoost(page('docs/file-conventions/middleware.mdx', 'middleware.js'), q)).toBeGreaterThan(
      nameBoost(page('docs/adapters/output-types.mdx', 'Output Types', 'Middleware'), q),
    );
    const env = 'How do I expose an environment variable to the browser?';
    expect(nameBoost(page('docs/guides/environment-variables.mdx', 'How to use environment variables in Next.js'), env)).toBeGreaterThan(
      nameBoost(page('docs/glossary.mdx', 'Next.js Glossary', 'Environment Variables'), env),
    );
  });

  it('is 1 when nothing in the name matches', () => {
    expect(nameBoost(page('docs/a.md', 'Alpha', 'Beta'), 'install')).toBe(1);
    expect(nameBoost(page('docs/a.md'), 'how do I')).toBe(1);
  });
});
