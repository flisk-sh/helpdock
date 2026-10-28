// reStructuredText (Django's docs, Python's, Sphinx projects) as Markdown, for indexing and display. Not a full RST
// parser: the part of it documentation is written in, converted line by line: section titles from their underlines,
// literal blocks, the Sphinx directives and roles that carry content, lists, and tables as preformatted text.
// Everything it does not understand is dropped or kept as plain text, never as markup.

const indentOf = (line: string) => line.length - line.trimStart().length;
const blank = (line: string | undefined) => line === undefined || line.trim() === '';

/** A line made of one repeated punctuation character, three or more: a title underline or a transition. */
const adornment = (line: string | undefined) => (line !== undefined && /^([=\-`:'"~^_*+#<>])\1{2,}\s*$/.test(line) ? line.trim()[0] : null);

const PLAIN_ROLES = new Set(['ref', 'doc', 'numref', 'term', 'abbr', 'guilabel', 'menuselection', 'sub', 'sup', 'download', 'any', 'envvar']);

/** Inline RST as Markdown: roles, literals, hyperlinks and the references that need no output. */
export function inlineRst(text: string): string {
  const keep: string[] = [];
  const hold = (md: string) => `\u0001${keep.push(md) - 1}\u0001`;
  let out = text
    // ``literal`` first, so nothing inside it is touched
    .replace(/``([^`]+)``/g, (_, code: string) => hold(`\`${code}\``))
    // :role:`text <target>` and :role:`target`
    .replace(/:(?:[a-z]+:)?([a-z-]+):`([^`]+)`/gi, (_, role: string, raw: string) => {
      const body = raw.replace(/\s+/g, ' ').trim(); // a role may be wrapped across lines
      const m = /^(.*?)\s*<([^>]+)>$/.exec(body);
      let label = m ? m[1] || m[2] : body;
      // :ref:`some-label` and :doc:`/ref/models` carry no text of their own: show the target as words
      if (!m && /^(ref|doc|numref)$/i.test(role)) label = (label.split('/').pop() ?? label).replace(/[-_]+/g, ' ');
      // `~pkg.mod.Name` shows Name; a leading `!` only stops cross-referencing
      label = !m && label.startsWith('~') ? (label.slice(1).split('.').pop() ?? label) : label.replace(/^[~!]/, '');
      return PLAIN_ROLES.has(role.toLowerCase()) ? hold(label) : hold(`\`${label}\``);
    })
    // `text <https://...>`_ and `text <target>`__
    .replace(/`([^`<]+?)\s*<([^>]+)>`__?/g, (_, label: string, url: string) => {
      const text = label.replace(/\s+/g, ' ');
      return hold(/^(https?:\/\/|mailto:)/i.test(url.trim()) ? `[${text}](${url.trim()})` : text);
    })
    // `name`_ (a reference to a named target) and `name`__
    .replace(/`([^`]+)`__?(?![\w`])/g, (_, label: string) => hold(label))
    // footnote and citation references
    .replace(/\s?\[[#\w*-]+\]_(?![\w])/g, '')
    // `interpreted text` (the default role)
    .replace(/(?<![\w`])`([^`]+)`(?![\w`])/g, (_, code: string) => hold(`\`${code}\``));
  out = out
    .replace(/\|(version|release|today)\|/g, '$1')
    // backslash escapes: "\ " joins words and "\s" after a role is a plural ("`QuerySet`\s")
    .replace(/\\ /g, '')
    .replace(/\\([^\s\\])/g, '$1')
    .replace(/\u0001(\d+)\u0001/g, (_, n: string) => keep[Number(n)]);
  return out;
}

const ALERT: Record<string, string> = {
  note: 'NOTE',
  seealso: 'NOTE',
  tip: 'TIP',
  hint: 'TIP',
  important: 'IMPORTANT',
  attention: 'IMPORTANT',
  warning: 'WARNING',
  danger: 'WARNING',
  error: 'WARNING',
  caution: 'CAUTION',
  admonition: 'NOTE',
};
const SIGNATURE = new Set(['class', 'method', 'function', 'attribute', 'data', 'exception', 'staticmethod', 'classmethod', 'decorator', 'property']);
const KEEP = new Set(['only', 'container', 'glossary', 'list-table', 'table', 'hlist', 'centered', 'topic', 'sidebar', 'epigraph', 'compound', 'pull-quote', 'highlights']);
const DROP = new Set(['toctree', 'index', 'image', 'figure', 'contents', 'module', 'currentmodule', 'include', 'tabularcolumns', 'highlight', 'default-role', 'sectionauthor', 'codeauthor', 'cssclass', 'literalinclude', 'productionlist', 'only-wip', 'raw', 'meta', 'role', 'moduleauthor', 'versionmodified']);
const CODE = new Set(['code-block', 'sourcecode', 'code', 'parsed-literal', 'console']);
const VERSION: Record<string, string> = { versionadded: 'New in version', versionchanged: 'Changed in version', deprecated: 'Deprecated since version' };

const fenceLang = (lang: string) => lang.trim().split(/[+\s]/)[0].replace(/^pycon$/, 'python').replace(/^doscon$/, 'bat');
const fence = (lang: string, lines: string[]) => ['```' + fenceLang(lang), ...lines, '```'];

function dedent(lines: string[]): string[] {
  const min = Math.min(...lines.filter((l) => l.trim()).map(indentOf), Infinity);
  return lines.map((l) => (l.trim() ? l.slice(min === Infinity ? 0 : min) : ''));
}

function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && blank(lines[a])) a++;
  while (b > a && blank(lines[b - 1])) b--;
  return lines.slice(a, b);
}

/** The indented block under line `start` (indent greater than `indent`), without trailing blank lines. */
function takeBlock(lines: string[], start: number, indent: number): { body: string[]; next: number } {
  const body: string[] = [];
  let j = start + 1;
  while (j < lines.length) {
    const l = lines[j];
    if (blank(l)) {
      body.push('');
      j++;
      continue;
    }
    if (indentOf(l) <= indent) break;
    body.push(l);
    j++;
  }
  return { body: trimBlank(body), next: j };
}

interface Ctx {
  styles: string[];
}

function convert(input: string[], ctx: Ctx, _top: boolean): string[] {
  const lines = input;
  const out: string[] = [];
  let i = 0;

  const push = (...ls: string[]) => out.push(...ls);

  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      push('');
      i++;
      continue;
    }
    const ind = indentOf(line);
    const text = line.trim();

    // Comments, labels, substitution definitions, footnotes and directives
    if (/^\.\.(\s|$)/.test(text)) {
      const dir = /^\.\.\s+([\w:+-]+)::\s*(.*)$/.exec(text);
      const { body: rawBody, next } = takeBlock(lines, i, ind);
      i = next;
      if (!dir) continue; // `.. _label:`, `.. |sub| replace::`, `.. [1] note`, `.. comment`
      const name = dir[1].replace(/^[a-z]+:/, '').toLowerCase();
      const arg = dir[2].trim();
      // Directive options (":caption: x") come first in the body, up to the first blank line.
      let k = 0;
      while (k < rawBody.length && /^\s*:[\w-]+:/.test(rawBody[k])) k++;
      const body = trimBlank(rawBody.slice(k));

      if (CODE.has(name)) {
        push(...fence(name === 'console' ? 'console' : arg || 'text', dedent(body)), '');
      } else if (name in ALERT) {
        const kind = ALERT[name];
        // ".. note:: text" starts the first paragraph on the directive line; its continuation is the body.
        const inner = trimBlank(convert(name !== 'admonition' && arg ? [arg, ...dedent(body)] : dedent(body), { styles: [] }, false));
        const title = name === 'admonition' && arg ? [`**${inlineRst(arg)}**`, ''] : name === 'seealso' ? ['**See also**', ''] : [];
        push(`> [!${kind}]`, ...[...title, ...inner].map((l) => (l ? `> ${l}` : '>')), '');
      } else if (name in VERSION) {
        const tail = trimBlank(convert(dedent(body), { styles: [] }, false)).join(' ');
        push(`> *${VERSION[name]} ${arg}.*${tail ? ` ${tail}` : ''}`, '');
      } else if (name === 'rubric') {
        push(`**${inlineRst(arg)}**`, '');
      } else if (KEEP.has(name)) {
        push(...trimBlank(convert(dedent(body), { styles: [] }, false)), '');
      } else if (SIGNATURE.has(name) || (arg && body.length > 0 && !DROP.has(name))) {
        // Sphinx and Django object descriptions: the signature as a heading, then the description.
        // A section titled "filter()" right above ".. method:: filter(*args)" would show the name twice: keep the signature.
        const nameOf = (t: string) => t.replace(/[`#]/g, '').trim().split('(')[0].split('.').pop()?.trim();
        const above = [...out].reverse().find((l) => l.trim() !== '');
        if (arg && above && /^#{1,4} /.test(above) && nameOf(above) === nameOf(arg) && !/^#{1,4} `?[\w.]+\(/.test(above.replace(/\(\)`?$/, ''))) {
          const at = out.lastIndexOf(above);
          out.splice(at, 1);
        }
        if (arg) push(`#### \`${arg.replace(/`/g, '')}\``, '');
        push(...trimBlank(convert(dedent(body), { styles: [] }, false)), '');
      }
      continue;
    }

    // Section title: underlined, or over- and underlined
    const under = adornment(lines[i + 1]);
    const over = adornment(line);
    if (over && !blank(lines[i + 1]) && adornment(lines[i + 2]) === over && !adornment(lines[i + 1])) {
      const level = styleLevel(ctx, `over${over}`);
      push(`${'#'.repeat(level)} ${inlineRst(lines[i + 1].trim())}`, '');
      i += 3;
      continue;
    }
    if (ind === 0 && under && !over && lines[i + 1].trim().length >= 3 && text.length > 0 && !/^[-*+]\s/.test(text)) {
      const level = styleLevel(ctx, under);
      push(`${'#'.repeat(level)} ${inlineRst(text)}`, '');
      i += 2;
      continue;
    }

    // Transition
    if (over && ind === 0 && blank(out[out.length - 1] ?? '') && blank(lines[i + 1])) {
      push('---', '');
      i++;
      continue;
    }

    // Tables, as preformatted text: grid tables and simple tables
    if (/^(\+[-=+]+\+|\|)/.test(text) && ind === 0) {
      const t: string[] = [];
      while (i < lines.length && !blank(lines[i])) t.push(lines[i++]);
      push(...fence('text', t), '');
      continue;
    }
    if (/^=+(\s+=+)+\s*$/.test(text)) {
      const t: string[] = [];
      let borders = 0;
      while (i < lines.length) {
        if (/^=+(\s+=+)+\s*$/.test(lines[i].trim())) borders++;
        if (blank(lines[i]) && borders >= 2) break;
        t.push(lines[i++]);
      }
      push(...fence('text', trimBlank(t)), '');
      continue;
    }

    // Doctest blocks
    if (text.startsWith('>>> ')) {
      const t: string[] = [];
      while (i < lines.length && !blank(lines[i])) t.push(lines[i++]);
      push(...fence('python', dedent(t)), '');
      continue;
    }

    // A paragraph, list or definition: consecutive non-blank lines
    const para: string[] = [];
    while (i < lines.length && !blank(lines[i]) && !(para.length > 0 && /^\.\.(\s|$)/.test(lines[i].trim()) && indentOf(lines[i]) <= ind)) {
      // A title underline right after the first lines belongs to the next block only when it follows a single line.
      if (para.length > 0 && adornment(lines[i + 1]) && lines[i + 1].trim().length >= 3 && indentOf(lines[i]) === 0 && !adornment(lines[i])) break;
      para.push(lines[i++]);
    }
    const first = para[0].trim();
    const literal = /::\s*$/.test(para[para.length - 1]);
    let block: string[];
    if (/^([-*+•]|\d+[.)]|#\.)\s/.test(first)) {
      block = dedent(para).map((l) => l.replace(/^(\s*)#\.\s/, (_, sp: string) => `${sp}1. `));
    } else if (para.length > 1 && indentOf(para[0]) < indentOf(para[1]) && first.length < 100) {
      // definition list: "term" then its indented definition
      block = [`**${first}**`, '', ...dedent(para.slice(1)).map((l) => l.trim())];
    } else {
      block = para.map((l) => l.trim());
    }
    if (literal) {
      // "text::" is "text:" and a lone "::" disappears; the indented block that follows is the literal.
      const t = block[block.length - 1].trimEnd();
      block[block.length - 1] = t === '::' ? '' : /\s::$/.test(t) ? t.slice(0, -3).trimEnd() : t.slice(0, -1);
    }
    // Inline markup may wrap across lines, so the block is converted as a whole.
    const fields = block.map((l) => (/^\s*:[\w ]+:\s/.test(l) ? l.replace(/^(\s*):([\w ]+):\s/, '$1**$2:** ') : l));
    push(...trimBlank(inlineRst(fields.join('\n')).split('\n')), '');

    if (literal) {
      // The literal block: the indented lines that follow.
      let j = i;
      while (j < lines.length && blank(lines[j])) j++;
      if (j < lines.length && indentOf(lines[j]) > ind) {
        const { body, next } = takeBlock(lines, j - 1, ind);
        push(...fence('text', dedent(body)), '');
        i = next;
      }
    }
  }
  return out;
}

function styleLevel(ctx: Ctx, style: string): number {
  let at = ctx.styles.indexOf(style);
  if (at < 0) {
    ctx.styles.push(style);
    at = ctx.styles.length - 1;
  }
  return Math.min(at + 1, 4);
}

/** reStructuredText as Markdown. */
export function rstToMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').replace(/\t/g, '    ').split('\n');
  const out = convert(lines, { styles: [] }, true);
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Whether a repository path holds reStructuredText: .rst anywhere, .txt under docs/ (Django writes its docs in .txt). */
export function isRstPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith('.rst')) return true;
  return lower.endsWith('.txt') && /(^|\/)docs?\//.test(lower) && !/(^|\/)(requirements|constraints|robots|license|licence|authors|notice|contributors|copying|readme)[^/]*\.txt$/.test(lower);
}
