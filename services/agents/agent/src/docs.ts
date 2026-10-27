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

// The answer without a model: the best matching passages, each with its citation number.
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

// The prompt for a model answer: numbered passages, and the rule to cite them and nothing else.
export function buildPrompt(question: string, hits: SearchHit[]): { system: string; user: string } {
  const passages = hits
    .map((h, i) => `[${i + 1}] ${h.title}${h.section ? ' > ' + h.section : ''}\n${cleanSnippet(h.snippet)}`)
    .join('\n\n');
  return {
    system:
      'You are a help center assistant. Answer only from the numbered passages. Cite each claim with its number, ' +
      'like [1]. If the passages do not answer the question, say so in one sentence. Keep it short.',
    user: `Passages:\n\n${passages}\n\nQuestion: ${question}`,
  };
}

// Keep only the sources the model actually cited, renumbered in order, so the list under the answer matches it.
export function citedAnswer(reply: string, hits: SearchHit[]): Answer {
  const cited = [...new Set([...reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].filter(
    (n) => n >= 1 && n <= hits.length,
  );
  const renumber = new Map(cited.map((n, i) => [n, i + 1]));
  const text = reply.replace(/\[(\d+)\]/g, (m, d) => (renumber.has(Number(d)) ? `[${renumber.get(Number(d))}]` : m));
  return { reply: text, sources: sourceList(cited.map((n) => hits[n - 1])) };
}
