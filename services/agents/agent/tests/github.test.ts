import { describe, expect, it } from 'vitest';
import { docPriority, fileUrl, githubAnchor, isDocPath, mkdocsToMarkdown, normalizeMarkdown, parseRepoPath, selectDocs } from '../src/github';

describe('parseRepoPath', () => {
  it('reads owner, repo and the rest', () => {
    expect(parseRepoPath('/astral-sh/uv')).toEqual({ owner: 'astral-sh', repo: 'uv', rest: '' });
    expect(parseRepoPath('/astral-sh/uv/turn')).toEqual({ owner: 'astral-sh', repo: 'uv', rest: '/turn' });
    expect(parseRepoPath('/vercel/next.js/mcp')).toEqual({ owner: 'vercel', repo: 'next.js', rest: '/mcp' });
  });

  it('accepts pasted GitHub paths below a repository', () => {
    expect(parseRepoPath('/astral-sh/uv/tree/main/docs')?.rest).toBe('');
    expect(parseRepoPath('/astral-sh/uv/blob/main/README.md')?.rest).toBe('');
    expect(parseRepoPath('/astral-sh/uv.git')?.repo).toBe('uv');
  });

  it('rejects app routes and invalid names', () => {
    expect(parseRepoPath('/mcp/x')).toBeNull();
    expect(parseRepoPath('/health/x')).toBeNull();
    expect(parseRepoPath('/turn')).toBeNull();
    expect(parseRepoPath('/-bad/repo')).toBeNull();
    expect(parseRepoPath('/owner/..')).toBeNull();
    expect(parseRepoPath('/own%2Fer/repo')).toBeNull();
    expect(parseRepoPath(`/${'a'.repeat(40)}/repo`)).toBeNull();
  });
});

describe('isDocPath', () => {
  it('keeps docs and drops dependencies, fixtures, change logs and licences', () => {
    expect(isDocPath('README.md')).toBe(true);
    expect(isDocPath('docs/guide/install.mdx')).toBe(true);
    expect(isDocPath('src/index.ts')).toBe(false);
    expect(isDocPath('node_modules/x/README.md')).toBe(false);
    expect(isDocPath('tests/fixtures/a.md')).toBe(false);
    expect(isDocPath('CHANGELOG.md')).toBe(false);
    expect(isDocPath('packages/a/LICENSE.md')).toBe(false);
    expect(isDocPath('.github/PULL_REQUEST_TEMPLATE.md')).toBe(false);
    expect(isDocPath('.claude/worktrees/x/docs/a.md')).toBe(false);
    expect(isDocPath('docs/de/docs/index.md')).toBe(false);
    expect(isDocPath('docs/en/docs/index.md')).toBe(true);
    expect(isDocPath('i18n/pt-br/guide.md')).toBe(false);
    expect(isDocPath('docs/api/index.md')).toBe(true);
  });
});

describe('normalizeMarkdown', () => {
  it('turns front matter title into the heading', () => {
    expect(normalizeMarkdown('a.md', '---\ntitle: "Install"\nslug: x\n---\nRun it.')).toBe('# Install\n\nRun it.');
    expect(normalizeMarkdown('a.md', '---\ntitle: Ignored\n---\n# Real\n\nBody')).toBe('# Real\n\nBody');
  });

  it('strips MDX imports and JSX tags but keeps code fences and text', () => {
    const mdx = "import { Tab } from 'x'\n\n<Tabs>\n<Tab title=\"npm\">Install with npm</Tab>\n</Tabs>\n\n```js\nimport a from 'b'\n<Foo />\n```";
    expect(normalizeMarkdown('a.mdx', mdx)).toBe("Install with npm\n\n\n```js\nimport a from 'b'\n<Foo />\n```");
  });
});

describe('links', () => {
  it('builds GitHub anchors and file URLs', () => {
    expect(githubAnchor('Getting `started`: the CLI!')).toBe('getting-started-the-cli');
    expect(fileUrl({ owner: 'o', repo: 'r' }, 'abc', 'docs/a b.md', 'Install it')).toBe(
      'https://github.com/o/r/blob/abc/docs/a%20b.md#install-it',
    );
  });
});

describe('choosing files', () => {
  it('ranks docs and the root README over contributor and agent files', () => {
    expect(docPriority('README.md')).toBeGreaterThan(docPriority('docs/install.md'));
    expect(docPriority('docs/install.md')).toBeGreaterThan(docPriority('packages/x/README.md'));
    expect(docPriority('packages/x/README.md')).toBeGreaterThan(docPriority('AGENTS.md'));
    expect(docPriority('docs/install.md')).toBeGreaterThan(docPriority('agents/prompts/fix-bug.md'));
    expect(docPriority('docs/a.md')).toBeGreaterThan(docPriority('examples/demo/README.md'));
    expect(docPriority('docs/examples/custom.md')).toBe(docPriority('docs/custom.md'));
  });

  it('keeps the best files within the limits, in path order', () => {
    const f = (path: string, n = 10) => ({ path, text: 'x'.repeat(n) });
    const picked = selectDocs([f('AGENTS.md'), f('docs/b.md'), f('README.md'), f('docs/a.md', 1000)], { maxFiles: 3, maxTotalBytes: 100 });
    expect(picked.files.map((x) => x.path)).toEqual(['AGENTS.md', 'docs/b.md', 'README.md']);
  });
});

describe('mkdocsToMarkdown', () => {
  it('turns tabs and admonitions into labels with their bodies dedented, and keeps code fences', () => {
    const src = ['=== "pip"', '', '    ```bash', '    pip install x', '    ```', '', '!!! note "Heads up"', '    Read [the API][api].', '', 'After.'].join('\n');
    expect(mkdocsToMarkdown(src)).toBe(['**pip**', '', '```bash', 'pip install x', '```', '', '> **Heads up**', 'Read the API.', '', 'After.'].join('\n'));
  });

  it('drops snippet includes', () => {
    expect(mkdocsToMarkdown('a\n--8<-- "x.md"\nb')).toBe('a\nb');
  });
});
