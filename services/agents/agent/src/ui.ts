// The two pages, each one self-contained file with no build step and nothing loaded from elsewhere (the CSP allows
// only the page's own hashed script):
//   landingPage  / when HELPDOCK_REPOS=1: "replace github.com with helpdock.flisk.sh", with examples
//   centerPage   a help center: /owner/repo/ for a GitHub repository, or / (or /docs/) for this deployment's own docs
// Both read everything they show from the API next to them (./status, ./pages, ./page, ./turn), so the HTML is the
// same for every repository and its script hash never changes.

/** The repositories the landing page offers, built at start (HELPDOCK_PREWARM) so they open at once. */
export const EXAMPLE_REPOS = [
  'vercel/next.js',
  'shadcn-ui/ui',
  'ollama/ollama',
  'supabase/supabase',
  'n8n-io/n8n-docs',
  'modelcontextprotocol/modelcontextprotocol',
];

const EXAMPLE_NOTES: Record<string, string> = {
  'vercel/next.js': 'The React framework for the web',
  'shadcn-ui/ui': 'Components you copy into your app',
  'ollama/ollama': 'Run open models on your own machine',
  'supabase/supabase': 'The Postgres development platform',
  'n8n-io/n8n-docs': 'Workflow automation, the n8n docs',
  'modelcontextprotocol/modelcontextprotocol': 'The Model Context Protocol spec',
};

const css = String.raw`
:root { --bg:#f6f5f1; --panel:#ffffff; --ink:#17171a; --muted:#66655f; --line:#e3e1da; --accent:#0d7a62; --accent-ink:#ffffff; --tint:#e6f2ee; --code:#f1efe9; --warn:#9a5b00; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#121312; --panel:#1b1c1b; --ink:#ecebe6; --muted:#9c9b93; --line:#2c2d2b; --accent:#4fd1ac; --accent-ink:#0b1512; --tint:#163029; --code:#232422; --warn:#f0b35a; } }
:root[data-theme="dark"] { --bg:#121312; --panel:#1b1c1b; --ink:#ecebe6; --muted:#9c9b93; --line:#2c2d2b; --accent:#4fd1ac; --accent-ink:#0b1512; --tint:#163029; --code:#232422; --warn:#f0b35a; }
* { box-sizing:border-box; }
[hidden] { display:none !important; }
html, body { margin:0; background:var(--bg); color:var(--ink); }
body { font:16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing:antialiased; }
a { color:var(--accent); }
code, pre, .mono { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.wrap { max-width:1080px; margin:0 auto; padding:0 20px; }
.nav { display:flex; align-items:center; justify-content:space-between; gap:12px; height:64px; }
.brand { display:flex; align-items:center; gap:10px; font-weight:700; letter-spacing:-.01em; color:var(--ink); text-decoration:none; }
.mark { width:26px; height:26px; border-radius:8px; background:var(--accent); display:grid; place-items:center; color:var(--accent-ink); font-size:15px; font-weight:800; }
.navlinks { display:flex; gap:18px; font-size:15px; }
.navlinks a { color:var(--muted); text-decoration:none; }
.navlinks a:hover { color:var(--ink); }
.btn { font:inherit; font-weight:600; border:0; border-radius:12px; padding:0 18px; height:48px; background:var(--accent); color:var(--accent-ink); cursor:pointer; white-space:nowrap; }
.btn:disabled { opacity:.55; cursor:default; }
.ghost { font:inherit; font-size:14px; font-weight:500; padding:7px 14px; border-radius:999px; border:1px solid var(--line); background:var(--panel); color:var(--ink); cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; gap:6px; }
.ghost:hover { border-color:var(--accent); }
input.field { flex:1; min-width:0; font:inherit; height:48px; padding:0 16px; border:1px solid var(--line); border-radius:12px; background:var(--panel); color:var(--ink); }
input.field:focus { outline:2px solid var(--accent); outline-offset:1px; }
.row { display:flex; gap:8px; }
.muted { color:var(--muted); }
.md { overflow-wrap:anywhere; }
.md > :first-child { margin-top:0; } .md > :last-child { margin-bottom:0; }
.md p { margin:0 0 .7em; }
.md h4 { font-size:15px; margin:1em 0 .4em; }
.md ul, .md ol { margin:0 0 .7em; padding-left:1.3em; }
.md code { background:var(--code); padding:.1em .35em; border-radius:5px; font-size:.88em; }
.md pre { background:var(--code); padding:12px 14px; border-radius:10px; overflow:auto; font-size:13.5px; line-height:1.5; margin:0 0 .8em; }
.md pre code { background:none; padding:0; font-size:inherit; }
.md blockquote { margin:0 0 .7em; padding:2px 12px; border-left:3px solid var(--line); color:var(--muted); }
.md table { border-collapse:collapse; font-size:14px; margin:0 0 .8em; display:block; overflow:auto; }
.md th, .md td { border:1px solid var(--line); padding:5px 9px; text-align:left; vertical-align:top; }
footer.foot { color:var(--muted); font-size:14px; padding:36px 0 48px; display:flex; flex-wrap:wrap; gap:8px 20px; justify-content:space-between; }
`;

// A small Markdown renderer for excerpts and pages. Everything is HTML-escaped first, so text from a repository can
// never become markup; links are kept only for http(s) URLs or paths resolved against the file on GitHub.
export const markdownJs = String.raw`
function escHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
function safeHref(raw, base) {
  var href = raw.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  try {
    var u = /^https?:\/\//i.test(href) ? new URL(href) : (base ? new URL(href, base) : null);
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null;
    return escHtml(u.href);
  } catch (e) { return null; }
}
// Code spans in already-escaped text; with emphasis, bold and italics outside them.
function codeSpans(escaped, emphasis) {
  return escaped.split(/(\x60[^\x60]+\x60)/g).map(function (p) {
    if (/^\x60[^\x60]+\x60$/.test(p)) return '<code>' + p.slice(1, -1) + '</code>';
    if (!emphasis) return p;
    return p.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  }).join('');
}
// Links first (their label may hold a code span, like a command name), kept aside as placeholders while code spans and
// emphasis are rendered, then put back.
function inlineMd(text, base) {
  var links = [];
  var s = escHtml(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, function (m, label, href) {
      var u = safeHref(href, base), l = codeSpans(label, false);
      links.push(u ? '<a href="' + u + '" target="_blank" rel="noopener">' + l + '</a>' : l);
      return '\x00' + (links.length - 1) + '\x00';
    });
  return codeSpans(s, true).replace(/\x00(\d+)\x00/g, function (m, n) { return links[Number(n)]; });
}
function renderMd(src, base) {
  var lines = String(src || '').replace(/\r\n/g, '\n').split('\n'), out = [], i = 0;
  function isTag(l) { return /^\s*<\/?[a-zA-Z][^>]*>\s*$/.test(l); }
  while (i < lines.length) {
    var line = lines[i];
    var fence = /^\s*(\x60{3,}|~{3,})/.exec(line);
    if (fence) {
      var code = []; i++;
      while (i < lines.length && lines[i].trim().indexOf(fence[1]) !== 0) { code.push(lines[i]); i++; }
      i++; out.push('<pre><code>' + escHtml(code.join('\n')) + '</code></pre>'); continue;
    }
    if (!line.trim() || isTag(line)) { i++; continue; }
    var h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push('<h4>' + inlineMd(h[2], base) + '</h4>'); i++; continue; }
    if (/^\s*\|/.test(line)) {
      var rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      var cells = rows.filter(function (r) { return !/^\s*\|?\s*:?-{2,}/.test(r); }).map(function (r) { return r.trim().replace(/^\||\|$/g, '').split('|'); });
      out.push('<table>' + cells.map(function (c, n) { var tag = n === 0 ? 'th' : 'td'; return '<tr>' + c.map(function (x) { return '<' + tag + '>' + inlineMd(x.trim(), base) + '</' + tag + '>'; }).join('') + '</tr>'; }).join('') + '</table>');
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      var ordered = /^\s*\d/.test(line), items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        var m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) items.push(m[2]); else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out.push((ordered ? '<ol>' : '<ul>') + items.map(function (t) { return '<li>' + inlineMd(t.replace(/^\[( |x)\]\s*/i, ''), base) + '</li>'; }).join('') + (ordered ? '</ol>' : '</ul>'));
      continue;
    }
    if (/^\s*>/.test(line)) {
      var q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push('<blockquote>' + inlineMd(q.join(' ').replace(/^\[!(\w+)\]\s*/, '$1: '), base) + '</blockquote>');
      continue;
    }
    var para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*(\x60{3,}|~{3,})|\s*\||\s*([-*+]|\d+[.)])\s+|\s*>)/.test(lines[i]) && !isTag(lines[i])) { para.push(lines[i].trim()); i++; }
    if (para.length) out.push('<p>' + inlineMd(para.join(' '), base) + '</p>'); else i++;
  }
  return out.join('');
}
`;

const landingCss = String.raw`
.hero { padding:56px 0 28px; }
.eyebrow { display:inline-flex; gap:8px; align-items:center; font-size:13px; font-weight:600; color:var(--accent); background:var(--tint); padding:5px 12px; border-radius:999px; }
.hero h1 { font-size:clamp(34px, 5.6vw, 58px); line-height:1.04; letter-spacing:-.035em; margin:18px 0 16px; max-width:15ch; }
.hero p.lede { font-size:19px; color:var(--muted); max-width:58ch; margin:0 0 26px; }
.swap { display:inline-flex; flex-wrap:wrap; align-items:center; gap:0; font-size:clamp(15px, 2.4vw, 20px); background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:12px 16px; margin:0 0 22px; max-width:100%; overflow-wrap:anywhere; }
.swap s { color:var(--muted); text-decoration-thickness:2px; }
.swap b { color:var(--accent); }
.swap .arrow { color:var(--muted); margin:0 8px; }
form.open { max-width:640px; }
.examples { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:10px; margin:22px 0 8px; }
.ex { display:block; text-decoration:none; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
.ex:hover { border-color:var(--accent); }
.ex .name { font-weight:600; font-size:14.5px; overflow-wrap:anywhere; }
.ex .note { font-size:13.5px; color:var(--muted); }
.grid3 { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px; margin:44px 0 0; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:20px; }
.card h3 { margin:0 0 6px; font-size:17px; letter-spacing:-.01em; }
.card p { margin:0 0 10px; color:var(--muted); font-size:15px; }
.card pre { margin:0; background:var(--code); border-radius:10px; padding:10px 12px; font-size:12.5px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; }
.how { margin:44px 0 0; display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:18px; }
.how div { border-top:2px solid var(--line); padding-top:12px; }
.how b { display:block; margin-bottom:4px; }
.how span { color:var(--muted); font-size:15px; }
.err { color:var(--warn); font-size:14px; min-height:1.4em; margin-top:8px; }
@media (max-width: 560px) { form.open .row { flex-direction:column; } }
`;

const landingJs = String.raw`
function repoFromInput(v) {
  v = v.trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?(github\.com|helpdock\.flisk\.sh)\//i, '').replace(/\.git$/i, '');
  var m = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(\/.*)?$/.exec(v);
  return m ? m[1] + '/' + m[2] : null;
}
document.getElementById('open').onsubmit = function (e) {
  e.preventDefault();
  var repo = repoFromInput(document.getElementById('repo').value);
  if (!repo) { document.getElementById('err').textContent = 'Enter a public GitHub repository, like vercel/next.js, or paste a github.com link.'; return; }
  location.href = '/' + repo + '/';
};
document.querySelectorAll('[data-host]').forEach(function (el) { el.textContent = location.host; });
document.querySelectorAll('[data-mcp]').forEach(function (el) { el.textContent = 'claude mcp add --transport http nextjs ' + location.origin + '/vercel/next.js/mcp'; });
`;

function examples(): string {
  return EXAMPLE_REPOS.map(
    (r) =>
      `<a class="ex" href="/${r}/"><div class="name mono">${r}</div><div class="note">${EXAMPLE_NOTES[r] ?? ''}</div></a>`,
  ).join('');
}

export const landingPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Helpdock: any GitHub repo's docs as a help center and MCP server</title>
<meta name="description" content="Replace github.com with helpdock.flisk.sh: search and browse any public repository's docs, get cited answers, and plug them into your own AI over MCP. No signup, no API key.">
<meta property="og:title" content="Helpdock">
<meta property="og:description" content="Any GitHub repo's docs, as a help center and an MCP server. Replace github.com with helpdock.flisk.sh.">
<style>${css}${landingCss}</style>
</head>
<body>
<div class="wrap">
  <nav class="nav">
    <a class="brand" href="/"><span class="mark">H</span>Helpdock</a>
    <div class="navlinks"><a href="#how">How it works</a><a href="https://github.com/flisk-sh/helpdock">GitHub</a></div>
  </nav>
  <section class="hero">
    <span class="eyebrow">Open source · No signup · No API key</span>
    <h1>Any GitHub repo's docs, as a help center.</h1>
    <p class="lede">Search and browse a repository's Markdown, get answers quoted from the exact page with a link to it on GitHub, and give the same docs to your own AI over MCP.</p>
    <div class="swap mono">https://<s>github.com</s><span class="arrow">→</span><b data-host>helpdock.flisk.sh</b>/vercel/next.js</div>
    <form class="open" id="open"><div class="row"><input class="field mono" id="repo" autocomplete="off" spellcheck="false" placeholder="github.com/owner/repo" aria-label="GitHub repository"><button class="btn">Open help center</button></div><div class="err" id="err"></div></form>
    <div class="examples">${examples()}</div>
  </section>
  <section class="grid3">
    <div class="card"><h3>A help center</h3><p>Ask in your own words. Answers are passages quoted from the docs, each linked to its file and heading on GitHub. Every page is browsable.</p></div>
    <div class="card"><h3>An MCP server for your AI</h3><p>Every repository gets one at <span class="mono">/owner/repo/mcp</span>, for Claude, ChatGPT, Cursor or Codex:</p><pre class="mono" data-mcp>claude mcp add --transport http nextjs https://helpdock.flisk.sh/vercel/next.js/mcp</pre></div>
    <div class="card"><h3>Your AI, not ours</h3><p>Helpdock never calls a model and needs no key. Under each answer, one click hands the question and the cited passages to your ChatGPT or Claude.</p></div>
  </section>
  <section class="how" id="how">
    <div><b>Reads the repo</b><span>The public archive from GitHub, Markdown and MDX only, translations and tooling skipped.</span></div>
    <div><b>Indexes it in seconds</b><span>SQLite full-text search with stemming and ranking. No vector database, no embeddings.</span></div>
    <div><b>Keeps nothing about you</b><span>The URL is the state. Indexes are rebuilt from GitHub every six hours.</span></div>
    <div><b>Runs anywhere</b><span>Open source, built and run with <a href="https://github.com/flisk-sh/flisk">Flisk</a>. Point it at your own docs with <span class="mono">flisk up</span>.</span></div>
  </section>
  <footer class="foot"><span>Helpdock · <a href="https://github.com/flisk-sh/helpdock">flisk-sh/helpdock</a> · MIT</span><span>Public repositories only. Not affiliated with GitHub.</span></footer>
</div>
<script>${landingJs}</script>
</body>
</html>`;

const centerCss = String.raw`
.top { position:sticky; top:0; z-index:5; background:color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); }
.top .wrap { max-width:1280px; display:flex; align-items:center; gap:10px; height:58px; }
.crumb { display:flex; align-items:center; gap:10px; min-width:0; flex:1; }
.crumb .sep { color:var(--line); }
.label { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--ink); text-decoration:none; min-width:0; }
.pill { font-size:12.5px; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:3px 10px; white-space:nowrap; }
.layout { max-width:1280px; margin:0 auto; padding:0 20px; display:grid; grid-template-columns:280px minmax(0, 1fr); gap:32px; }
aside.side { position:sticky; top:58px; align-self:start; max-height:calc(100vh - 58px); overflow:auto; padding:18px 0 30px; }
.side input { width:100%; height:38px; font:inherit; font-size:14px; padding:0 12px; border:1px solid var(--line); border-radius:10px; background:var(--panel); color:var(--ink); }
.side .group { font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:16px 0 4px; overflow-wrap:anywhere; }
.side a.pg { display:block; font-size:14px; line-height:1.35; color:var(--ink); text-decoration:none; padding:5px 8px; border-radius:7px; overflow-wrap:anywhere; }
.side a.pg:hover, .side a.pg.on { background:var(--tint); color:var(--accent); }
.side .count { font-size:13px; color:var(--muted); margin-top:10px; }
main.main { padding:28px 0 60px; min-width:0; }
.main h1 { font-size:clamp(26px, 3.6vw, 36px); letter-spacing:-.025em; line-height:1.15; margin:0 0 6px; overflow-wrap:anywhere; }
.main .sub { color:var(--muted); margin:0 0 18px; }
.chips { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0 0; }
.chip { font:inherit; font-size:14px; padding:6px 12px; border-radius:999px; background:var(--tint); color:var(--accent); border:0; cursor:pointer; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px 18px; margin:0 0 18px; }
.panel h3 { margin:0 0 8px; font-size:15px; }
.panel pre { background:var(--code); border-radius:9px; padding:9px 12px; font-size:12.5px; margin:6px 0 10px; white-space:pre-wrap; overflow-wrap:anywhere; }
.panel .k { font-size:13px; color:var(--muted); margin-top:8px; }
.q { font-weight:650; font-size:18px; margin:30px 0 12px; letter-spacing:-.01em; overflow-wrap:anywhere; }
.hit { background:var(--panel); border:1px solid var(--line); border-radius:14px; margin:0 0 12px; overflow:hidden; }
.hit header { display:flex; gap:12px; align-items:flex-start; padding:14px 16px 0; }
.hit .n { flex:none; width:24px; height:24px; border-radius:7px; background:var(--tint); color:var(--accent); font-size:13px; font-weight:700; display:grid; place-items:center; margin-top:1px; }
.hit .t { font-weight:600; line-height:1.35; overflow-wrap:anywhere; }
.hit .p { font-size:12.5px; color:var(--muted); overflow-wrap:anywhere; }
.hit .meta { min-width:0; flex:1; }
.hit .open { flex:none; font-size:13.5px; text-decoration:none; white-space:nowrap; }
.hit .md { padding:10px 16px 14px 52px; font-size:15px; }
.ai { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:4px 0 0; font-size:14px; color:var(--muted); }
.none { color:var(--muted); padding:18px 0; }
.loading { display:flex; gap:14px; align-items:center; padding:40px 0; color:var(--muted); }
.spin { width:22px; height:22px; border-radius:50%; border:3px solid var(--line); border-top-color:var(--accent); animation:spin .8s linear infinite; flex:none; }
@keyframes spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation:none; } }
.article h2 { font-size:26px; letter-spacing:-.02em; margin:12px 0 4px; overflow-wrap:anywhere; }
.article h3 { font-size:18px; margin:26px 0 8px; overflow-wrap:anywhere; }
.article .md { font-size:15.5px; }
.back { font-size:14px; text-decoration:none; }
.warn { color:var(--warn); }
.mobile-pages { display:none; }
@media (max-width: 860px) {
  .layout { grid-template-columns:1fr; gap:0; }
  aside.side { position:static; max-height:none; padding:0; display:none; }
  aside.side.open { display:block; padding:12px 0; }
  .mobile-pages { display:inline-flex; }
  .hit .md { padding-left:16px; }
  .hide-sm { display:none; }
  .pill { display:none; }
}
`;

const centerJs = String.raw`
var base = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
var $ = function (id) { return document.getElementById(id); };
var info = null, pages = [], current = null;
var sid = (function () { try { var k = 'helpdock-sid'; var v = localStorage.getItem(k); if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); } return v; } catch (e) { return crypto.randomUUID(); } })();

function api(path, opts) {
  return fetch(base + path, opts).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (b) {
      if (!r.ok) { var e = new Error(b.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
      return b;
    });
  });
}
function copy(text, btn) {
  var label = btn.textContent;
  navigator.clipboard.writeText(text).then(function () { btn.textContent = 'Copied'; }, function () { btn.textContent = 'Copy failed'; });
  setTimeout(function () { btn.textContent = label; }, 1500);
}
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function dirOf(url) { if (!url) return null; var u = url.split('#')[0]; return u.slice(0, u.lastIndexOf('/') + 1); }
function setStatus(text, warn) { var p = $('pill'); p.textContent = text; p.className = 'pill' + (warn ? ' warn' : ''); }

function boot() {
  api('status').then(function (s) {
    info = s;
    document.title = s.label + ' · Helpdock';
    $('label').textContent = s.label;
    if (s.github) $('label').href = s.github; else $('label').removeAttribute('href');
    $('title').textContent = 'Ask the ' + s.label + ' docs';
    if (s.status === 'building') {
      var p = s.progress || { files: 0 };
      setStatus('Reading…');
      $('loadmsg').textContent = 'Reading ' + s.label + ' from GitHub…' + (p.files ? ' ' + p.files + ' Markdown files so far' : '');
      $('loading').hidden = false;
      return setTimeout(boot, 1200);
    }
    $('loading').hidden = true;
    if (s.status === 'error') {
      setStatus('Unavailable', true);
      $('fatal').hidden = false;
      $('fatalmsg').textContent = s.error || 'This repository could not be read.';
      return;
    }
    setStatus((s.files ? s.files + ' pages · ' : '') + s.sections + ' sections' + (s.sha ? ' · ' + s.sha.slice(0, 7) : '') + (s.truncated ? ' · partial' : ''));
    $('mcpurl').textContent = s.mcpUrl;
    var name = (s.label.split('/').pop() || 'docs').replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase();
    $('mcpcc').textContent = 'claude mcp add --transport http ' + name + ' ' + s.mcpUrl;
    var servers = {}; servers[name] = { url: s.mcpUrl };
    $('mcpjson').textContent = JSON.stringify({ mcpServers: servers }, null, 2);
    $('ask').hidden = false;
    loadPages();
    var hash = decodeURIComponent(location.hash.slice(1));
    if (hash.indexOf('page=') === 0) openPage(hash.slice(5));
    else if (hash.indexOf('q=') === 0) ask(hash.slice(2));
    else if (hash === 'mcp') $('mcp').hidden = false; // a link straight to "Use in your AI"
    else $('q').focus();
  }).catch(function (e) {
    setStatus('Unavailable', true);
    $('loading').hidden = true;
    $('fatal').hidden = false;
    $('fatalmsg').textContent = e.status === 503 ? 'Busy right now; retrying…' : (e.message || 'Could not load this help center.');
    if (e.status === 503) setTimeout(function () { $('fatal').hidden = true; boot(); }, 4000);
  });
}

function dirOfSource(s) { return s.indexOf('/') === -1 ? '' : s.slice(0, s.lastIndexOf('/')); }
// Docs first: folders ordered by their best page's priority, then by name; pages by priority, then title.
function orderPages(list) {
  var best = {};
  list.forEach(function (p) { var d = dirOfSource(p.source); best[d] = Math.max(best[d] == null ? -99 : best[d], p.priority || 0); });
  return list.slice().sort(function (a, b) {
    var da = dirOfSource(a.source), db = dirOfSource(b.source);
    if (da !== db) return (best[db] - best[da]) || da.localeCompare(db);
    return ((b.priority || 0) - (a.priority || 0)) || a.title.localeCompare(b.title);
  });
}
function loadPages() {
  api('pages').then(function (b) { pages = orderPages(b.pages); renderSide(''); renderChips(); });
}
function renderSide(filter) {
  var box = $('tree'); box.textContent = '';
  var f = filter.toLowerCase(), shown = 0, lastGroup = null;
  pages.forEach(function (p) {
    if (f && (p.title + ' ' + p.source).toLowerCase().indexOf(f) === -1) return;
    var dir = dirOfSource(p.source);
    if (dir !== lastGroup) { box.append(el('div', 'group', dir || 'Top level')); lastGroup = dir; }
    var a = el('a', 'pg' + (current === p.source ? ' on' : ''), p.title);
    a.href = '#page=' + encodeURIComponent(p.source);
    a.title = p.source;
    a.onclick = function (e) { e.preventDefault(); openPage(p.source); };
    box.append(a); shown++;
  });
  $('count').textContent = shown + ' of ' + pages.length + ' pages';
}
function renderChips() {
  // Questions a newcomer asks first, in that order, each from the page that answers it (matched on the page's own
  // name and title, not its folder); then other doc pages. The repository's own name is not a question.
  var topics = [/getting[-_ ]?started|quick[-_ ]?start/i, /install/i, /overview|introduction|^intro/i, /configur|config/i, /usage|guide/i, /tutorial/i, /faq/i, /troubleshoot/i, /migrat/i, /features?/i, /concepts?/i];
  var repoName = (info && info.label ? info.label.split('/').pop() : '').toLowerCase();
  var good = pages.filter(function (p) { return (p.priority || 0) > 0 && p.title.toLowerCase() !== repoName; });
  var name = function (p) { return p.source.split('/').pop().replace(/\.(md|mdx|markdown)$/i, '') + ' ' + p.title; };
  var picks = [];
  topics.forEach(function (re) { var hit = good.find(function (p) { return re.test(name(p)) && picks.indexOf(p) === -1; }); if (hit) picks.push(hit); });
  picks = picks.concat(good);
  var box = $('chips'); box.textContent = '';
  var seen = {}, n = 0;
  picks.forEach(function (p) {
    var t = p.title.length > 48 ? p.title.slice(0, 46) + '…' : p.title;
    if (n >= 5 || seen[t.toLowerCase()]) return; seen[t.toLowerCase()] = 1; n++;
    var b = el('button', 'chip', t); b.type = 'button'; b.onclick = function () { ask(p.title); };
    box.append(b);
  });
}

function aiRow(prompt) {
  var row = el('div', 'ai'); row.append('Ask your AI:');
  var g = el('a', 'ghost', 'ChatGPT'); g.href = 'https://chatgpt.com/?q=' + encodeURIComponent(prompt); g.target = '_blank'; g.rel = 'noopener';
  var c = el('button', 'ghost', 'Claude'); c.type = 'button';
  c.onclick = function () { copy(prompt, c); setTimeout(function () { window.open('https://claude.ai/new?q=' + encodeURIComponent(prompt), '_blank', 'noopener'); }, 150); };
  var o = el('button', 'ghost', 'Copy prompt'); o.type = 'button'; o.onclick = function () { copy(prompt, o); };
  row.append(g, c, o);
  return row;
}

function ask(question) {
  question = String(question || '').trim();
  if (!question) return;
  showView('answers');
  current = null; renderSide($('filter').value);
  history.replaceState(null, '', '#q=' + encodeURIComponent(question));
  $('q').value = question;
  var box = $('answers'); box.textContent = '';
  box.append(el('div', 'q', question));
  var wait = el('div', 'loading'); wait.append(el('div', 'spin'), el('span', null, 'Searching the docs…')); box.append(wait);
  $('go').disabled = true;
  api('turn', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': sid }, body: JSON.stringify({ input: question }) })
    .then(function (b) {
      wait.remove();
      if (!b.sources.length) { box.append(el('div', 'none', 'Nothing in these docs matches that. Try other words, or browse the pages.')); return; }
      b.sources.forEach(function (s) {
        var card = el('article', 'hit');
        var head = el('header');
        var meta = el('div', 'meta'); meta.append(el('div', 't', s.title + (s.section ? ' › ' + s.section : '')), el('div', 'p mono', s.source));
        head.append(el('span', 'n', String(s.n)), meta);
        var view = el('a', 'open', 'Read page'); view.href = '#page=' + encodeURIComponent(s.source);
        view.onclick = function (e) { e.preventDefault(); openPage(s.source, s.section); };
        head.append(view);
        if (s.url) { var gh = el('a', 'open hide-sm', 'GitHub ↗'); gh.href = s.url; gh.target = '_blank'; gh.rel = 'noopener'; head.append(gh); }
        var body = el('div', 'md'); body.innerHTML = renderMd(s.excerpt, dirOf(s.url));
        card.append(head, body); box.append(card);
      });
      box.append(aiRow(b.prompt));
    })
    .catch(function (e) { wait.remove(); box.append(el('div', 'none', e.status === 429 ? 'Too many questions from here; wait a little.' : 'Something went wrong: ' + e.message)); })
    .finally(function () { $('go').disabled = false; });
}

function openPage(source, section) {
  showView('article');
  current = source; renderSide($('filter').value);
  history.replaceState(null, '', '#page=' + encodeURIComponent(source));
  var box = $('article'); box.textContent = '';
  var wait = el('div', 'loading'); wait.append(el('div', 'spin'), el('span', null, 'Opening…')); box.append(wait);
  api('page?source=' + encodeURIComponent(source)).then(function (p) {
    box.textContent = '';
    var back = el('a', 'back', '← Ask a question'); back.href = '#'; back.onclick = function (e) { e.preventDefault(); showView('answers'); history.replaceState(null, '', '#'); $('q').focus(); };
    box.append(back, el('h2', null, p.title), el('div', 'p mono muted', source));
    if (p.url) { var gh = el('a', 'ghost', 'Open on GitHub ↗'); gh.href = p.url; gh.target = '_blank'; gh.rel = 'noopener'; gh.style.marginTop = '10px'; box.append(gh); }
    var target = null;
    p.sections.forEach(function (s) {
      if (s.section) { var h = el('h3', null, s.section); box.append(h); if (s.section === section) target = h; }
      var md = el('div', 'md'); md.innerHTML = renderMd(s.body, dirOf(p.url)); box.append(md);
    });
    if (target) target.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
    if (window.innerWidth < 860) $('side').classList.remove('open');
  }).catch(function (e) { box.textContent = ''; box.append(el('div', 'none', 'Could not open this page: ' + e.message)); });
}

function showView(which) { $('answers').hidden = which !== 'answers'; $('article').hidden = which !== 'article'; $('ask').hidden = which === 'article'; }

$('f').onsubmit = function (e) { e.preventDefault(); ask($('q').value); };
$('filter').oninput = function () { renderSide($('filter').value); };
$('mcpbtn').onclick = function () { $('mcp').hidden = !$('mcp').hidden; };
$('copymcp').onclick = function () { copy($('mcpurl').textContent, $('copymcp')); };
$('copycc').onclick = function () { copy($('mcpcc').textContent, $('copycc')); };
$('pagesbtn').onclick = function () { $('side').classList.toggle('open'); };
boot();
`;

export const centerPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Helpdock</title>
<meta name="description" content="Search, browse and ask this repository's docs, with answers quoted from the exact page. Also an MCP server for your AI.">
<style>${css}${centerCss}</style>
</head>
<body>
<div class="top"><div class="wrap">
  <div class="crumb"><a class="brand" href="/"><span class="mark">H</span><span class="hide-sm">Helpdock</span></a><span class="sep">/</span><a class="label mono" id="label" target="_blank" rel="noopener">…</a><span class="pill" id="pill">Loading…</span></div>
  <button class="ghost mobile-pages" id="pagesbtn" type="button">Pages</button>
  <button class="ghost" id="mcpbtn" type="button">Use in your AI</button>
</div></div>
<div class="layout">
  <aside class="side" id="side"><input id="filter" placeholder="Filter pages" aria-label="Filter pages" autocomplete="off"><div id="tree"></div><div class="count" id="count"></div></aside>
  <main class="main">
    <section class="panel" id="mcp" hidden>
      <h3>Give these docs to your own AI</h3>
      <div class="k">MCP server (Streamable HTTP, no key). Tools: <span class="mono">search_docs</span>, <span class="mono">ask_help_center</span>.</div>
      <pre class="mono" id="mcpurl"></pre><button class="ghost" id="copymcp" type="button">Copy URL</button>
      <div class="k">Claude Code:</div><pre class="mono" id="mcpcc"></pre><button class="ghost" id="copycc" type="button">Copy command</button>
      <div class="k">Cursor, Windsurf and other clients (mcp.json):</div><pre class="mono" id="mcpjson"></pre>
    </section>
    <div class="loading" id="loading" hidden><div class="spin"></div><span id="loadmsg">Reading the repository…</span></div>
    <div id="fatal" hidden><h1>Can't open this one</h1><p class="sub" id="fatalmsg"></p><a class="ghost" href="/">Try another repository</a></div>
    <section id="ask" hidden>
      <h1 id="title">Ask the docs</h1>
      <p class="sub">Answers are passages quoted from the docs, linked to the exact page. Hand them to your own AI for a written answer.</p>
      <form id="f" class="row"><input class="field" id="q" autocomplete="off" placeholder="Ask in your own words, e.g. how do I install it?" aria-label="Question" maxlength="500"><button class="btn" id="go">Ask</button></form>
      <div class="chips" id="chips"></div>
    </section>
    <section id="answers"></section>
    <section id="article" class="article" hidden></section>
  </main>
</div>
<script>${markdownJs}${centerJs}</script>
</body>
</html>`;
