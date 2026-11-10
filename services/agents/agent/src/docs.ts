// Pure help-center logic: split Markdown into sections, and turn search hits into a cited answer.
// No I/O here, so everything in this file is covered by tests/docs.test.ts.

export interface DocChunk {
  source: string;
  title: string;
  section: string;
  body: string;
}

export interface SearchHit {
  id: number;
  source: string;
  title: string;
  section: string;
  snippet: string;
  rank: number;
  /** The whole section, when the store returns it; excerpts are cut from it. */
  body?: string;
}

export interface Source {
  n: number;
  title: string;
  section: string;
  source: string;
  /** Markdown: the paragraphs (or code block) of the section that best match the question. */
  excerpt: string;
  /** The excerpt with its HTML reduced to text: what the reply, MCP and the AI prompt carry. */
  text: string;
  /** Where the section lives, when known (a GitHub file and heading). */
  url?: string;
  /** The same page inside the help center, so a reader can stay there. */
  page?: string;
}

export interface Answer {
  reply: string;
  sources: Source[];
}

export type LinkFor = (hit: SearchHit) => string | undefined;

const MAX_SECTION_CHARS = 4000;

/** A heading as plain text: links and images reduced to their text, emphasis and trailing #s dropped. */
export function cleanHeading(heading: string): string {
  return heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`/g, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/\s*\{\s*[#.][^}]*\}\s*$/, '') // MkDocs attribute lists: "## Install {#install}", "{ #install }"
    .trim();
}

/** A page title from its path when the page has no # heading: docs/getting-started/index.md → "Getting started". */
export function titleFromPath(source: string): string {
  const parts = source.replace(/\.(md|mdx|markdown|rst|txt)$/i, '').split('/');
  let name = parts.pop() ?? source;
  if (/^(index|readme)$/i.test(name) && parts.length > 0) name = parts.pop() as string;
  // Doc sites order their files with number prefixes (01-installation.mdx): the reader does not need them.
  const words = name.replace(/^\d+[-_.]\s*/, '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : source;
}

// One chunk per `#`, `##` or `###` heading. The page title is the first `#` heading, or the file name.
// Headings inside fenced code blocks are ignored, so a shell comment is never read as a section or the title.
export function chunkMarkdown(source: string, markdown: string): DocChunk[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let title = titleFromPath(source);
  let fenced = false;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    else if (!fenced && /^#\s+\S/.test(l)) {
      title = cleanHeading(l.replace(/^#\s+/, '')) || title;
      break;
    }
  }

  const chunks: DocChunk[] = [];
  let section = '';
  let buf: string[] = [];
  let inFence = false;

  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) chunks.push({ source, title, section, body: body.slice(0, MAX_SECTION_CHARS) });
    buf = [];
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = !inFence && /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      section = heading[1] === '#' ? '' : cleanHeading(heading[2]);
      continue;
    }
    buf.push(line);
  }
  flush();

  // The unique key is (source, section): merge repeated headings instead of dropping them.
  const merged = new Map<string, DocChunk>();
  for (const c of chunks) {
    const prev = merged.get(c.section);
    if (prev) prev.body = (prev.body + '\n\n' + c.body).slice(0, MAX_SECTION_CHARS);
    else merged.set(c.section, { ...c });
  }
  return [...merged.values()];
}

// Strip the markers ts_headline puts around matches, and the Markdown that reads as noise in a plain-text reply
// (code fences and their language, table rules and pipes, bold), then collapse whitespace.
export function cleanSnippet(snippet: string): string {
  return snippet
    .replace(/<\/?b>/g, '')
    .replace(/(```|~~~)[a-z]*/g, '')
    .replace(/\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?/g, ' ')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/·(\s*·)+/g, '·')
    .replace(/^(\s*·\s*)+|(\s*·\s*)+$/g, '')
    .trim();
}

const MAX_EXCERPT_CHARS = 900;

// A section's body as blocks: paragraphs, lists and tables split on blank lines, a fenced code block kept whole.
function blocks(body: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  const flush = () => {
    if (cur.join('').trim()) out.push(cur.join('\n').trim());
    cur = [];
  };
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inFence) flush();
      cur.push(line);
      inFence = !inFence;
      if (!inFence) flush();
      continue;
    }
    if (!inFence && !line.trim()) flush();
    else cur.push(line);
  }
  flush();
  return out;
}

function matches(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  // A word, or for longer words their first five letters, so "install" also finds "installing".
  return words.filter((w) => lower.includes(w.length > 5 ? w.slice(0, 5) : w)).length;
}

/**
 * The part of a section worth reading for a question: from the block that matches the most question words, the
 * blocks that follow it, up to `max` characters. A first block longer than that is cut at a sentence. Markdown in,
 * Markdown out.
 */
export function excerpt(body: string, question: string, max = MAX_EXCERPT_CHARS): string {
  const all = blocks(body);
  if (all.length === 0) return '';
  const words = queryWords(question);
  let best = 0;
  let bestScore = -1;
  for (const [i, b] of all.entries()) {
    const score = matches(b, words);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  // A match in a short lead-in ("Run:") reads better with the block it introduces, and vice versa: start one block
  // earlier when the best block is a code block or a list right after a short paragraph.
  if (best > 0 && /^(```|~~~|[-*] |\d+\. |\|)/.test(all[best]) && all[best - 1].length < 300) best -= 1;
  const picked: string[] = [];
  let size = 0;
  for (const b of all.slice(best)) {
    if (picked.length > 0 && size + b.length > max) {
      // A one-line lead-in ("Install it with:") is useless without what follows: take the start of the next block.
      if (size < 350) picked.push(clip(b, max - size));
      break;
    }
    picked.push(b);
    size += b.length;
  }
  let text = picked.join('\n\n');
  // Only a single first block can still be over the size (later blocks were checked or clipped as they were added).
  if (picked.length === 1 && text.length > max && !/^(```|~~~)/.test(text)) {
    const cut = text.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
    text = `${(end > max / 2 ? cut.slice(0, end + 1) : cut).trimEnd()} …`;
  }
  return text;
}

// The start of a block within `room` characters: whole lines of a code block (fence closed again), else whole
// sentences.
function clip(block: string, room: number): string {
  const budget = Math.max(room, 240);
  if (/^(```|~~~)/.test(block)) {
    const lines = block.split('\n');
    const fence = lines[0].match(/^(```|~~~)/)?.[1] ?? '```';
    const kept: string[] = [];
    let n = 0;
    for (const l of lines.slice(0, -1)) {
      if (n + l.length > budget && kept.length > 1) break;
      kept.push(l);
      n += l.length + 1;
    }
    return kept.length < lines.length - 1 ? `${kept.join('\n')}\n…\n${fence}` : block;
  }
  if (block.length <= budget) return block;
  const cut = block.slice(0, budget);
  const end = cut.lastIndexOf('\n') > budget / 2 ? cut.lastIndexOf('\n') : cut.lastIndexOf('. ') + 1;
  return `${cut.slice(0, end > 0 ? end : budget).trimEnd()} …`;
}

/**
 * Hits with the same page title and section collapsed to one: docs often keep a copy per version
 * (specification/2025-06-18/..., specification/2025-11-25/...). Of equally ranked copies the one with the greater
 * path, usually the newest version, is kept, in the place of the first.
 */
export function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const kept = new Map<string, SearchHit>();
  for (const h of hits) {
    const key = `${h.title}\u0000${h.section}`.toLowerCase();
    const prev = kept.get(key);
    if (!prev) kept.set(key, h);
    else if (Math.abs(prev.rank - h.rank) <= Math.abs(prev.rank) * 0.02 && h.source > prev.source) kept.set(key, h);
  }
  return [...kept.values()];
}

/** Every hit as a numbered source with its excerpt and link. */
export function toSources(question: string, hits: SearchHit[], link?: LinkFor, toText: (md: string) => string = (m) => m, page?: LinkFor): Source[] {
  return hits.map((h, i) => {
    const quote = h.body !== undefined ? excerpt(h.body, question) : cleanSnippet(h.snippet);
    const src: Source = { n: i + 1, title: h.title, section: h.section, source: h.source, excerpt: quote, text: toText(quote).trim(), url: link?.(h) };
    const here = page?.(h);
    return here ? { ...src, page: here } : src;
  });
}

// The answer: the best matching passages, each with its citation number.
export function extractiveAnswer(question: string, hits: SearchHit[], link?: LinkFor, toText?: (md: string) => string, page?: LinkFor): Answer {
  if (hits.length === 0) {
    return {
      reply: `I couldn't find anything about "${question}" in the docs. Try other words, or browse the pages.`,
      sources: [],
    };
  }
  const sources = toSources(question, dedupeHits(hits).slice(0, 3), link, toText, page);
  const lines = sources.map((s) => `[${s.n}] ${s.title}${s.section ? ' › ' + s.section : ''}\n${s.text}`);
  return { reply: `Here's what the docs say:\n\n${lines.join('\n\n')}`, sources };
}

const MAX_PROMPT_CHARS = 6000;

// The prompt a visitor takes to their own AI (the "Ask your AI" buttons): the question, the cited passages, and the
// rule to answer from them only. Kept under MAX_PROMPT_CHARS so it fits in a prefill URL.
export function aiPrompt(question: string, sources: Source[], siteUrl: string): string {
  const head =
    `Answer my question using only the passages below from the help center at ${siteUrl}. ` +
    'Cite each claim with its number, like [1]. If the passages do not answer it, say so.\n\n' +
    `Question: ${question}\n\nPassages:\n`;
  let body = '';
  for (const s of sources.slice(0, 3)) {
    const passage = `\n[${s.n}] ${s.title}${s.section ? ' › ' + s.section : ''} (${s.url ?? s.source})\n${s.text}\n`;
    if (head.length + body.length + passage.length > MAX_PROMPT_CHARS) break;
    body += passage;
  }
  return head + (body || '\n(no matching passages)\n');
}

// English words too common to search on; Postgres's english configuration drops them the same way.
const STOP_WORDS = new Set(
  (
    'a an and are as at be but by can do does for from has have how i if in into is it its me my no not of on or our ' +
    'should so that the their them then there these they this to was we what when where which who why will with you your ' +
    // Words that frame a comparison ("difference between X and Y", "X vs Y") and say nothing about its topic.
    'between difference differences versus vs'
  ).split(' '),
);

// A question as an SQLite FTS5 query: its words, without stop words and duplicates, each quoted (so FTS5 syntax in a
// question is never run) and OR'ed, so bm25 ranks the sections that match the most of them first. Null when nothing
// is left to search for.
export function ftsQuery(question: string): string | null {
  const words = queryWords(question);
  if (words.length === 0) return null;
  const extra = words.flatMap((w) => SYNONYMS.get(w) ?? []).filter((w) => !words.includes(w));
  return [...words, ...new Set(extra)].map((w) => `"${w}"`).join(' OR ');
}

// The words people evaluating a project ask with are often not the words its docs use: "what does it cost" is
// answered under "Licence", "how do we leave" under "Uninstall". Each group's words are also searched for the others
// (OR'ed after the question's own words, so a page with the asker's word still ranks by it).
const SYNONYM_GROUPS = [
  ['cost', 'costs', 'price', 'pricing', 'paid', 'pay', 'license', 'licence', 'licensing'],
  ['kubernetes', 'k8s'],
  ['leave', 'leaving', 'uninstall', 'eject', 'offboard'],
  ['existing', 'adopt', 'adoption', 'import', 'migrate', 'brownfield'],
  ['ci', 'pipeline'],
  ['install', 'installation', 'setup'],
  ['repo', 'repos', 'repository', 'repositories'],
  ['secure', 'security', 'secrets', 'vulnerability'],
];
const SYNONYMS = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) for (const w of group) SYNONYMS.set(w, group.filter((o) => o !== w));

/** A question's search words: lower case, without stop words, one-letter words and duplicates. */
export function queryWords(question: string): string[] {
  const words = (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 32);
}

/** A page's lead as one plain sentence or two, for the page cards: its first paragraph, Markdown removed. */
export function summarize(body: string, max = 160): string {
  const plain = (b: string) =>
    b
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // a linked badge ([![](badge.svg)](url)) leaves nothing, not "[](url)"
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  // The first paragraph that still has words once its badges, images and markup are gone.
  const text =
    blocks(body)
      .filter((b) => !/^(```|~~~|\||<|>|!\[|[-*+] |\d+\. )/.test(b))
      // A paragraph of links only, or a navigation line ("← Back to the README"), says nothing about the page.
      .filter((b) => !/^(\[[^\]]*\]\([^)]*\)[\s·|•,/-]*)+$/.test(b) && !/^\[?\s*[←→«»⬅➡↩]/.test(b))
      .map(plain)
      .find((t) => /[a-z]{3}/i.test(t)) ?? '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf('. ');
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`;
}

// Two words match when equal, or for longer words when their first five letters agree (variable, variables).
function sameWord(a: string, b: string): boolean {
  return a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
}

/** The words a page's file is named by: docs/01-app/environment-variables.mdx → environment, variables. */
export function fileWords(source: string): string[] {
  const parts = source.toLowerCase().replace(/\.(md|mdx|markdown|rst|txt)$/, '').split('/');
  let name = parts.pop() ?? '';
  if (/^(index|readme)$/.test(name) && parts.length > 0) name = parts.pop() as string;
  return name
    .replace(/^\d+[-_.]/, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
}

/**
 * How much a page's name says it is about the question, as a multiplier for its rank: the share of its file-name
 * words the question contains weighs most (middleware.mdx for "how do I add middleware"), then its title's, then the
 * section heading's. The page's intro, the text before its first subheading, says what the whole page is
 * for, so on a page named after the question it counts once more (ci.md's intro for "how do I use it in CI").
 * 1 when nothing matches.
 */
export function nameBoost(hit: Pick<SearchHit, 'source' | 'title' | 'section'>, question: string): number {
  const words = queryWords(question);
  if (words.length === 0) return 1;
  const share = (list: string[]) => (list.length ? list.filter((w) => words.some((q) => sameWord(q, w))).length / list.length : 0);
  const file = share(fileWords(hit.source));
  return (
    1 +
    1.6 * file +
    (hit.section === '' ? 0.8 * file : 0) +
    0.8 * share(queryWords(hit.title)) +
    0.6 * share(queryWords(hit.section)) +
    3 * headingAsks(hit.section, question)
  );
}

// Words that only frame a comparison ("flisk up vs tilt up", "difference between X and Y"): left out when matching a
// question to a heading, so the compared things decide.
const FRAME_WORDS = new Set(['vs', 'versus', 'difference', 'differences', 'between', 'compared', 'compare', 'use']);

/**
 * 1 when a section heading asks the question itself ("Do we need Kubernetes to run Flisk?", "flisk up vs tilt up" for
 * "difference between flisk up and tilt up"): nearly all of the question's words are in the heading and nearly all of
 * the heading's are in the question. Else 0, so a long page that merely mentions the words does not win on this.
 */
export function headingAsks(section: string, question: string): number {
  const words = (s: string) => queryWords(s).filter((w) => !FRAME_WORDS.has(w));
  const q = words(question);
  const h = words(section);
  if (q.length < 3 || h.length < 2) return 0; // "install flisk" is too short to tell one heading from another
  const covered = (from: string[], into: string[]) => from.filter((w) => into.some((o) => sameWord(o, w))).length / from.length;
  return Math.min(covered(q, h), covered(h, q)) >= 0.75 ? 1 : 0;
}

/**
 * What the project is, in one line, for the top of its help center: the README's first heading when it says more than
 * the name ("Flisk: local development for multi-service apps"), else nothing. `html` is the rendered README.
 */
export function aboutFromReadme(html: string, name: string): string {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '';
  const text = h1
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const words = text.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length < 4 || text.length > 160) return '';
  if (text.toLowerCase().replace(/[^a-z0-9]/g, '') === name.toLowerCase().replace(/[^a-z0-9]/g, '')) return '';
  return text;
}
