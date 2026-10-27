import { describe, expect, it } from 'vitest';
import { markdownJs } from '../src/ui';

// The page's own renderer, run here as the browser runs it.
const renderMd = new Function(`${markdownJs}; return renderMd;`)() as (src: string, base?: string | null) => string;
const base = 'https://github.com/o/r/blob/sha/docs/';

describe('renderMd', () => {
  it('renders links whose label is code, resolving relative paths against the file on GitHub', () => {
    expect(renderMd('Use [`uv python pin`](../reference/cli.md#pin) now.', base)).toBe(
      '<p>Use <a href="https://github.com/o/r/blob/sha/reference/cli.md#pin" target="_blank" rel="noopener"><code>uv python pin</code></a> now.</p>',
    );
  });

  it('renders code blocks, lists, tables, quotes and headings', () => {
    const html = renderMd('## Install\n\n- one `a`\n- **two**\n\n```sh\necho <x>\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> note', base);
    expect(html).toBe(
      '<h4>Install</h4><ul><li>one <code>a</code></li><li><strong>two</strong></li></ul><pre><code>echo &lt;x&gt;</code></pre>' +
        '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><blockquote>note</blockquote>',
    );
  });

  it('never turns repository text into markup or script', () => {
    const html = renderMd('<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1)) [y](" onmouseover="alert(1))', base);
    expect(html).not.toMatch(/<img|<script|javascript:|onmouseover="/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('drops a bare HTML line and images, and keeps http(s) links only', () => {
    expect(renderMd('<details>\n\nText ![logo](logo.png) [site](https://a.dev) [ftp](ftp://x)', base)).toBe(
      '<p>Text  <a href="https://a.dev/" target="_blank" rel="noopener">site</a> ftp</p>',
    );
  });
});
