import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inScope, repoBase, sparsePatterns, parseLsTree, docPriority, fileUrl, githubAnchor, htmlToMarkdown, isDocPath, mkdocsToMarkdown, normalizeMarkdown, parseRepoPath, readRepoViaGit, selectDocs } from '../src/github';

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
    expect(isDocPath('docs/releases/5.2.txt')).toBe(false);
    expect(isDocPath('docs/topics/db/models.txt')).toBe(true);
    expect(isDocPath('docs/intro/index.rst')).toBe(true);
    expect(isDocPath('i18n/pt-br/guide.md')).toBe(false);
    expect(isDocPath('docs/api/index.md')).toBe(true);
  });
});

describe('normalizeMarkdown', () => {
  it('turns front matter title into the heading', () => {
    expect(normalizeMarkdown('a.md', '---\ntitle: "Install"\nslug: x\n---\nRun it.')).toBe('# Install\n\nRun it.');
    expect(normalizeMarkdown('a.md', '---\ntitle: Glossary\n---\n# A\n\n```sh\n# comment\n```\n\nBody')).toBe(
      '# Glossary\n\n## A\n\n```sh\n# comment\n```\n\nBody',
    );
  });

  it('strips MDX imports and JSX tags but keeps code fences and text', () => {
    const mdx = "import { Tab } from 'x'\n\n<Tabs>\n<Tab title=\"npm\">Install with npm</Tab>\n</Tabs>\n\n```js\nimport a from 'b'\n<Foo />\n```";
    expect(normalizeMarkdown('a.mdx', mdx)).toBe("Install with npm\n\n\n```js\nimport a from 'b'\n<Foo />\n```");
    expect(normalizeMarkdown('a.mdx', '{/* The content is shared.\n Keep it. */}\n\nReal text.')).toBe('Real text.');
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
    expect(docPriority('contributing/docs/guide.md')).toBeLessThan(4);
    expect(docPriority('docs/marketing/articles/stop-compose.md')).toBeLessThan(docPriority('docs/cheat-sheet.md'));
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

describe('htmlToMarkdown', () => {
  it('turns tables of image links into text and drops comments', () => {
    const src = '<!-- generated -->\n<table>\n<tr><td><sub><b>1. Language?</b></sub><br><a href="x.md"><img src="a.svg" alt="TypeScript"></a></td><td><img src="b.svg" alt="Go"></td></tr>\n</table>\n\n**Could fit.**';
    expect(htmlToMarkdown(src).trim()).toBe('1. Language?\nTypeScript · Go\n\n**Could fit.**');
  });

  it('leaves code alone', () => {
    expect(htmlToMarkdown('Use `<App>` and <kbd>Ctrl</kbd>.\n```html\n<div>x</div>\n```')).toBe('Use `<App>` and Ctrl.\n```html\n<div>x</div>\n```');
  });
});

describe('parseLsTree', () => {
  it('keeps regular files with their sizes, not symlinks or submodules, and paths with spaces', () => {
    const out = ['100644 blob aaa      12\tREADME.md', '120000 blob bbb      9\tdocs/link.md', '160000 commit ccc       -\tvendor/x', '100755 blob ddd    4096\tdocs/a b.md', ''].join('\u0000');
    expect(parseLsTree(out)).toEqual([
      { path: 'README.md', size: 12 },
      { path: 'docs/a b.md', size: 4096 },
    ]);
    expect(parseLsTree('100644 blob aaa\tdocs/x.md\u0000')).toEqual([{ path: 'docs/x.md', size: 1 }]);
  });
});

describe('folders of a repository', () => {
  const tf = '/hashicorp/web-unified-docs/tree/main/content/terraform/v1.17.x/docs';

  it('reads a GitHub tree URL as a scope', () => {
    expect(parseRepoPath(`${tf}/`)).toEqual({ owner: 'hashicorp', repo: 'web-unified-docs', rest: '', scope: 'content/terraform/v1.17.x/docs', branch: 'main' });
    expect(parseRepoPath(`${tf}/mcp`)?.rest).toBe('/mcp');
    expect(parseRepoPath(`${tf}/mcp`)?.scope).toBe('content/terraform/v1.17.x/docs');
    expect(parseRepoPath('/o/r/tree/main/docs')).toMatchObject({ scope: 'docs', rest: '' });
    expect(parseRepoPath('/o/r/tree/main/turn')).toMatchObject({ rest: '/turn' });
  });

  it('keeps plain repositories and refuses unsafe folders', () => {
    expect(parseRepoPath('/o/r/')).toEqual({ owner: 'o', repo: 'r', rest: '/' });
    expect(parseRepoPath('/o/r/blob/main/README.md')?.scope).toBeUndefined();
    expect(parseRepoPath('/o/r/tree/main/a/../b')).toBeNull();
    expect(parseRepoPath('/o/r/tree/main/a%2F..%2Fb/x')).toBeNull(); // an encoded slash cannot smuggle a ".." in
  });

  it('puts the scope in the page address, in what git reads and in what is in range', () => {
    expect(repoBase({ owner: 'o', repo: 'r' })).toBe('/o/r/');
    expect(repoBase({ owner: 'o', repo: 'r', scope: 'a/b', branch: 'dev' })).toBe('/o/r/tree/dev/a/b/');
    expect(sparsePatterns('a/b')).toEqual(['/a/b/']);
    expect(sparsePatterns()).toContain('/docs/**/*.txt');
    expect(inScope('a/b/c.md', 'a/b')).toBe(true);
    expect(inScope('a/bc/c.md', 'a/b')).toBe(false);
    expect(inScope('x.md')).toBe(true);
  });
});

describe('HashiCorp MDX', () => {
  it('turns callouts into quotes and drops includes, and uses page_title', () => {
    const src = '---\npage_title: Expressions - Configuration Language\n---\n\n@include \'x.mdx\'\n\n~> **Warning:** Be careful.\n\nText.';
    expect(normalizeMarkdown('a.mdx', src)).toBe('# Expressions - Configuration Language\n\n\n\n> **Warning:** Be careful.\n\nText.');
  });
});

describe('reading a repository with git', () => {
  // A local repository stands in for github.com (url.<path>.insteadOf), so this runs offline.
  it('never follows a symlink out of the clone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'helpdock-test-'));
    const env = { ...process.env };
    try {
      const secret = join(dir, 'secret.txt');
      writeFileSync(secret, 'server-only secret');
      const work = join(dir, 'work');
      const sh = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'ignore' });
      mkdirSync(join(work, 'docs'), { recursive: true });
      sh('init', '-q');
      writeFileSync(join(work, 'README.md'), '# Hi\n\nHello.');
      symlinkSync(secret, join(work, 'docs', 'leak.md'));
      sh('add', '-A');
      sh('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
      Object.assign(process.env, {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.file://${work}/.git.insteadOf`,
        GIT_CONFIG_VALUE_0: 'https://github.com/evil/repo.git',
      });
      const read = await readRepoViaGit({ owner: 'evil', repo: 'repo' });
      expect(read.files.map((f) => f.path)).toEqual(['README.md']);
      expect(JSON.stringify(read.files)).not.toContain('server-only secret');
    } finally {
      process.env = env;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
