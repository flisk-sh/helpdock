import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMarkdown } from '@flisk-sh/md2html';
import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../src/docs';
import { htmlToMarkdown, normalizeMarkdown } from '../src/github';

// Real pages through Helpdock's whole pipeline (normalize, split into sections, render each section), committed so
// the check is deterministic and offline. A page that comes out "half broken" (HTML shown as escaped text), anything
// executable, or HTML left in the search text fails the build.
const dir = join(import.meta.dirname, 'fixtures');
const base = 'https://github.com/flisk-sh/flisk/blob/main/README.md';
const ESCAPED_TAG = /&lt;\/?(a|img|p|div|table|tr|td|th|br|picture|source|details|summary|sub|sup|b|kbd)[\s>/]/gi;

describe.each(readdirSync(dir).filter((f) => f.endsWith('.md')))('%s', (file) => {
  const sections = chunkMarkdown(file, normalizeMarkdown(file, readFileSync(join(dir, file), 'utf8')));

  it('has sections', () => {
    expect(sections.length).toBeGreaterThan(0);
  });

  it('renders every section with no HTML left escaped and nothing executable', () => {
    for (const s of sections) {
      const html = renderMarkdown(s.body, { baseUrl: base, headingIds: false });
      const prose = html.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '');
      expect({ section: s.section, escaped: prose.match(ESCAPED_TAG) ?? [] }).toEqual({ section: s.section, escaped: [] });
      expect(html).not.toMatch(/<(script|iframe|object|embed|style|form)\b/i);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      for (const [, url] of html.matchAll(/(?:href|src)="([^"]*)"/g)) expect(url).toMatch(/^(https?:\/\/|mailto:|#)/);
    }
  });

  it('gives search plain text, with no HTML tags left outside code', () => {
    for (const s of sections) {
      const text = htmlToMarkdown(s.body).replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
      expect(text.match(/<\/?(a|img|p|div|table|tr|td|br|picture|source|sub|b)\b[^>]*>/gi) ?? []).toEqual([]);
    }
  });
});
