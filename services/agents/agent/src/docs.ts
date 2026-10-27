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
}

export interface Answer {
  reply: string;
  sources: Array<{ n: number; title: string; section: string; source: string }>;
}

const MAX_SECTION_CHARS = 4000;

// One chunk per `#`, `##` or `###` heading. The page title is the first `#` heading, or the file name.
// Headings inside fenced code blocks are ignored, so a shell comment is never read as a section.
export function chunkMarkdown(source: string, markdown: string): DocChunk[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let title = source.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
  const titleLine = lines.find((l) => /^#\s+\S/.test(l));
  if (titleLine) title = titleLine.replace(/^#\s+/, '').trim();

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
      section = heading[1] === '#' ? '' : heading[2].trim();
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

function sourceList(hits: SearchHit[]): Answer['sources'] {
  return hits.map((h, i) => ({ n: i + 1, title: h.title, section: h.section, source: h.source }));
}

// The answer: the best matching passages, each with its citation number.
export function extractiveAnswer(question: string, hits: SearchHit[]): Answer {
  if (hits.length === 0) {
    return {
      reply: `I couldn't find anything about "${question}" in the docs. Try other words, or ask a person on the team.`,
      sources: [],
    };
  }
  const top = hits.slice(0, 3);
  const lines = top.map((h, i) => `${cleanSnippet(h.snippet)} [${i + 1}]`);
  return { reply: `Here's what the docs say:\n\n${lines.join('\n\n')}`, sources: sourceList(top) };
}

const MAX_PROMPT_CHARS = 6000;

// The prompt a visitor takes to their own AI (the "Ask your AI" buttons): the question, the cited passages, and the
// rule to answer from them only. Kept under MAX_PROMPT_CHARS so it fits in a prefill URL.
export function aiPrompt(question: string, hits: SearchHit[], siteUrl: string): string {
  const head =
    `Answer my question using only the passages below from the help center at ${siteUrl}. ` +
    'Cite each claim with its number, like [1]. If the passages do not answer it, say so.\n\n' +
    `Question: ${question}\n\nPassages:\n`;
  let body = '';
  for (const [i, h] of hits.slice(0, 3).entries()) {
    const passage = `\n[${i + 1}] ${h.title}${h.section ? ' › ' + h.section : ''} (${h.source})\n${cleanSnippet(h.snippet)}\n`;
    if (head.length + body.length + passage.length > MAX_PROMPT_CHARS) break;
    body += passage;
  }
  return head + (body || '\n(no matching passages)\n');
}

// English words too common to search on; Postgres's english configuration drops them the same way.
const STOP_WORDS = new Set(
  (
    'a an and are as at be but by can do does for from has have how i if in into is it its me my no not of on or our ' +
    'should so that the their them then there these they this to was we what when where which who why will with you your'
  ).split(' '),
);

// A question as an SQLite FTS5 query: its words, without stop words and duplicates, each quoted (so FTS5 syntax in a
// question is never run) and OR'ed, so bm25 ranks the sections that match the most of them first. Null when nothing
// is left to search for.
export function ftsQuery(question: string): string | null {
  const words = (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  const unique = [...new Set(words)].slice(0, 32);
  return unique.length > 0 ? unique.map((w) => `"${w}"`).join(' OR ') : null;
}
