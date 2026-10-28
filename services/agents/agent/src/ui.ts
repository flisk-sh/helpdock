// The two pages, each one self-contained file with no build step and nothing loaded from elsewhere (the CSP allows
// only the page's own hashed script):
//   landingPage  / when HELPDOCK_REPOS=1: "replace github.com with helpdock.flisk.sh", with examples
//   centerPage   a help center: /owner/repo/ for a GitHub repository, or / (or /docs/) for this deployment's own docs
// Both read everything they show from the API next to them (./status, ./pages, ./page, ./turn). Only the <head>
// differs per repository (title, description, canonical address, social card); the script and its hash never change.
import { head, type PageMeta, SITE } from './seo';

/** The address canonical links and the social card use: HELPDOCK_PUBLIC_URL, else the production site. */
const SITE_BASE = (process.env.HELPDOCK_PUBLIC_URL || SITE.url).replace(/\/$/, '');

/** The repositories the landing page offers, built at start (HELPDOCK_PREWARM) so they open at once. */
export interface Example {
  /** What follows helpdock.flisk.sh/: owner/repo, or owner/repo/tree/<branch>/<folder> for a folder of it. */
  path: string;
  name: string;
  /** The GitHub account whose avatar is shown. */
  owner: string;
  note: string;
}

export const EXAMPLES: Example[] = [
  { path: 'vercel/next.js', name: 'vercel/next.js', owner: 'vercel', note: 'The React framework for the web' },
  { path: 'reactjs/react.dev', name: 'reactjs/react.dev', owner: 'reactjs', note: 'The React docs, from react.dev' },
  { path: 'django/django', name: 'django/django', owner: 'django', note: 'The web framework for perfectionists' },
  { path: 'hashicorp/web-unified-docs/tree/main/content/terraform/v1.17.x/docs', name: 'hashicorp/terraform', owner: 'hashicorp', note: 'Infrastructure as code: the Terraform docs' },
  { path: 'tanstack/query', name: 'tanstack/query', owner: 'tanstack', note: 'Async state and data fetching' },
  { path: 'oven-sh/bun', name: 'oven-sh/bun', owner: 'oven-sh', note: 'JavaScript runtime, bundler and package manager' },
  { path: 'fastapi/fastapi', name: 'fastapi/fastapi', owner: 'fastapi', note: 'Modern, fast Python web APIs' },
  { path: 'shadcn-ui/ui', name: 'shadcn-ui/ui', owner: 'shadcn-ui', note: 'Components you copy into your app' },
  { path: 'ollama/ollama', name: 'ollama/ollama', owner: 'ollama', note: 'Run open models on your own machine' },
  { path: 'n8n-io/n8n-docs', name: 'n8n-io/n8n-docs', owner: 'n8n-io', note: 'Workflow automation, the n8n docs' },
  { path: 'modelcontextprotocol/modelcontextprotocol', name: 'modelcontextprotocol/modelcontextprotocol', owner: 'modelcontextprotocol', note: 'The Model Context Protocol spec' },
  { path: 'flisk-sh/flisk', name: 'flisk-sh/flisk', owner: 'flisk-sh', note: 'Your whole app running locally, one command' },
];

/** The paths built at start (HELPDOCK_PREWARM) so the landing page's examples open at once. */
export const EXAMPLE_REPOS = EXAMPLES.map((e) => e.path);

/** Search engines index only the examples. Any other repository's text is not ours to vouch for, so a page built from
 * someone's repository can't rank under this domain (or get it flagged) for what that repository says. */
export const indexable = (path: string) => EXAMPLE_REPOS.includes(path.replace(/\/$/, ''));

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
input.field { flex:1 1 auto; min-width:0; font:inherit; font-size:16px; height:48px; min-height:48px; padding:0 16px; border:1px solid var(--line); border-radius:12px; background:var(--panel); color:var(--ink); }
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
.md img { max-width:100%; height:auto; vertical-align:middle; }
/* GitHub's theme images: a README marks its light and dark logo with these fragments, and only one shows. */
.md img[src*="#gh-dark-mode-only"] { display:none; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .md img[src*="#gh-dark-mode-only"] { display:inline; } :root:not([data-theme="light"]) .md img[src*="#gh-light-mode-only"] { display:none; } }
:root[data-theme="dark"] .md img[src*="#gh-dark-mode-only"] { display:inline; }
:root[data-theme="dark"] .md img[src*="#gh-light-mode-only"] { display:none; }
.md p[align="center"], .md div[align="center"], .md h1[align="center"], .md h2[align="center"], .md h3[align="center"] { text-align:center; }
.md h1, .md h2, .md h3, .md h5, .md h6 { margin:1em 0 .4em; line-height:1.25; }
.md h1 { font-size:22px; } .md h2 { font-size:19px; } .md h3 { font-size:16.5px; } .md h5, .md h6 { font-size:14px; }
.md hr { border:0; border-top:1px solid var(--line); margin:1.2em 0; }
.md details { border:1px solid var(--line); border-radius:10px; padding:6px 12px; margin:0 0 .8em; }
.md details > summary { cursor:pointer; font-weight:600; }
.md kbd { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.85em; border:1px solid var(--line); border-bottom-width:2px; border-radius:5px; padding:.05em .4em; }
.md li > input[type="checkbox"] { margin:0 .4em 0 0; vertical-align:middle; }
.md blockquote.alert { border-left-color:var(--accent); color:var(--ink); background:var(--tint); border-radius:0 8px 8px 0; padding:8px 12px; }
.md blockquote.alert-warning, .md blockquote.alert-caution { border-left-color:var(--warn); }
.md th, .md td { border:1px solid var(--line); padding:5px 9px; text-align:left; vertical-align:top; }
.stage { position:relative; overflow:hidden; background:#06090a; color:#f2f4f3; --bg:#06090a; --panel:#0f1514; --ink:#f2f4f3; --muted:#a3aead; --line:#223030; --accent:#4fd1ac; --accent-ink:#06100d; --tint:#12302a; --code:#141c1b; }
.stage::before { content:""; position:absolute; inset:0; background-image:linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px); background-size:56px 56px; -webkit-mask-image:radial-gradient(65% 70% at 35% 25%, #000 25%, transparent 100%); mask-image:radial-gradient(65% 70% at 35% 25%, #000 25%, transparent 100%); pointer-events:none; }
.stage::after { content:""; position:absolute; inset:-10%; background:radial-gradient(36% 30% at 18% 14%, rgba(79,209,172,.32), transparent 70%), radial-gradient(34% 30% at 85% 28%, rgba(56,130,246,.3), transparent 70%), radial-gradient(40% 34% at 55% 96%, rgba(168,85,247,.26), transparent 70%); pointer-events:none; }
.stage > * { position:relative; z-index:1; }
.grad { background:linear-gradient(92deg, #4fd1ac, #22d3ee 45%, #a78bfa); -webkit-background-clip:text; background-clip:text; color:transparent; }
.btn { background:linear-gradient(135deg, #14b8a6, #3b82f6); color:#fff; box-shadow:0 8px 24px -10px rgba(20,184,166,.8); }
.btn:hover { background:linear-gradient(135deg, #2dd4bf, #60a5fa); }
footer.foot { border-top:1px solid var(--line); margin-top:72px; }
footer.foot { color:var(--muted); font-size:14px; padding:36px 0 48px; display:flex; flex-wrap:wrap; gap:8px 20px; justify-content:space-between; }
`;

// A placeholder that types example phrases, deletes them and types the next, as if someone were typing. It stops
// while the field has focus or a value, and with reduced motion it shows the first phrase still.
const typewriterJs = String.raw`
function typewriter(input, phrases, prefix) {
  prefix = prefix || '';
  if (!phrases.length) return;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) { input.placeholder = prefix + phrases[0]; return; }
  var i = 0, n = 0, deleting = false, timer = null;
  function idle() { return document.activeElement !== input && !input.value; }
  function rest() { input.placeholder = prefix + phrases[i % phrases.length]; }
  function tick() {
    if (!idle()) { timer = null; rest(); return; }
    var word = phrases[i % phrases.length];
    n += deleting ? -1 : 1;
    input.placeholder = prefix + word.slice(0, n) + (deleting || n < word.length ? '|' : '');
    var wait = deleting ? 28 : 65 + Math.random() * 60;
    if (!deleting && n >= word.length) { deleting = true; wait = 1500; input.placeholder = prefix + word; }
    else if (deleting && n <= 0) { deleting = false; i++; wait = 350; }
    timer = setTimeout(tick, wait);
  }
  input.addEventListener('focus', function () { clearTimeout(timer); timer = null; rest(); });
  input.addEventListener('blur', function () { if (!timer && !input.value) { n = 0; deleting = false; timer = setTimeout(tick, 600); } });
  timer = setTimeout(tick, 500);
}
`;

const landingCss = String.raw`
.hero { padding:56px 0 28px; }
.eyebrow { display:inline-flex; gap:8px; align-items:center; font-size:13px; font-weight:600; color:var(--accent); background:var(--tint); padding:5px 12px; border-radius:999px; }
.hero h1 { font-size:clamp(34px, 5.6vw, 58px); line-height:1.04; letter-spacing:-.035em; margin:18px 0 16px; max-width:15ch; }
.hero p.lede { font-size:19px; color:var(--muted); max-width:58ch; margin:0 0 26px; }
.swap { display:inline-flex; flex-direction:column; gap:6px; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px 16px; margin:0 0 22px; max-width:100%; }
.swap .from { font-size:clamp(14px, 2vw, 17px); color:var(--muted); overflow-wrap:anywhere; }
.swap .from s { text-decoration-thickness:2px; }
.swap .to { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.swap .to a { font-size:clamp(16px, 2.6vw, 22px); color:var(--ink); text-decoration:none; overflow-wrap:anywhere; }
.swap .to a:hover { text-decoration:underline; }
.swap .to b { color:var(--accent); }
.demo { margin:28px 0 0; max-width:560px; }
.demo video, .demo img { display:block; width:100%; height:auto; border-radius:14px; border:1px solid var(--line); background:var(--panel); }
.demo .still { display:none; }
.sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
@media (prefers-reduced-motion: reduce) { .demo video { display:none; } .demo .still { display:block; } }
form.open { max-width:640px; }
.examples { display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:10px; margin:22px 0 8px; }
.ex { display:flex; gap:12px; align-items:center; text-decoration:none; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
.exav { width:36px; height:36px; border-radius:9px; flex:none; background:var(--line); }
.ex:hover { border-color:var(--accent); }
.ex .name { font-weight:600; font-size:14.5px; overflow-wrap:anywhere; }
.ex .note { font-size:13.5px; color:var(--muted); }
.grid3 { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px; margin:44px 0 0; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:20px; }
.card h3 { margin:0 0 6px; font-size:17px; letter-spacing:-.01em; }
.card p { margin:0 0 10px; color:var(--muted); font-size:15px; }
.codebox { position:relative; }
.codebox pre { padding-right:74px !important; }
.codebox .ghost { position:absolute; top:7px; right:7px; padding:3px 11px; font-size:12.5px; }
.card pre { margin:0; background:var(--code); border-radius:10px; padding:10px 12px; font-size:12.5px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; }
.how { margin:44px 0 0; display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:18px; }
.how div { border-top:2px solid var(--line); padding-top:12px; }
.how b { display:block; margin-bottom:4px; }
.how span { color:var(--muted); font-size:15px; }
.err { color:var(--warn); font-size:14px; min-height:1.4em; margin-top:8px; }
/* Stacked on phones: the box keeps its height (flex:1 in a column made it collapse to a sliver) and the button is full width. */
@media (max-width: 560px) { form.open .row { flex-direction:column; } form.open input.field { flex:none; width:100%; } form.open .btn { width:100%; } }
.stage .nav { border-bottom:1px solid rgba(255,255,255,.07); }
.stage .hero { padding:72px 0 0; }
.stage .eyebrow { background:rgba(79,209,172,.12); border:1px solid rgba(79,209,172,.3); }
.stage .hero h1 { font-size:clamp(38px, 6.4vw, 72px); font-weight:800; letter-spacing:-.045em; max-width:16ch; }
.stage .swap, .stage .ex, .stage input.field { background:rgba(255,255,255,.05); border-color:rgba(255,255,255,.13); }
.stage .swap .to b { background:linear-gradient(92deg, #4fd1ac, #22d3ee); -webkit-background-clip:text; background-clip:text; color:transparent; }
.stage .demo { max-width:none; margin:48px 0 0; border:1px solid rgba(255,255,255,.12); border-bottom:0; border-radius:16px 16px 0 0; overflow:hidden; background:#0f1514; box-shadow:0 -10px 90px -20px rgba(34,211,238,.45); }
.stage .demo .chrome { display:flex; gap:7px; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,.08); }
.stage .demo .chrome i { width:11px; height:11px; border-radius:50%; background:rgba(255,255,255,.16); }
.stage .demo video, .stage .demo img { border:0; border-radius:0; }
.card { position:relative; overflow:hidden; transition:transform .15s, border-color .15s; }
.card::before { content:""; position:absolute; left:0; right:0; top:0; height:3px; background:linear-gradient(90deg, #14b8a6, #3b82f6, #a78bfa); }
.card:hover { transform:translateY(-2px); border-color:color-mix(in srgb, var(--accent) 50%, var(--line)); }
section.grid3 { margin-top:72px; }
.how { counter-reset:h; }
section.how > div { counter-increment:h; border-top:0; padding-top:0; }
section.how > div::before { content:counter(h); display:grid; place-items:center; width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg, #14b8a6, #3b82f6); color:#fff; font-weight:750; margin-bottom:12px; }
`;

const landingJs = String.raw`
function repoFromInput(v) {
  v = v.trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?(github\.com|helpdock\.flisk\.sh)\//i, '').replace(/\.git$/i, '');
  var m = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(\/.*)?$/.exec(v);
  if (!m) return null;
  // A folder link (github.com/o/r/tree/main/docs) opens that folder as its own help center.
  var folder = /^\/tree\/[^/]+\/[^?#]+/.exec(m[3] || '');
  return m[1] + '/' + m[2] + (folder ? folder[0].replace(/\/$/, '') : '');
}
document.getElementById('open').onsubmit = function (e) {
  e.preventDefault();
  var repo = repoFromInput(document.getElementById('repo').value);
  if (!repo) { document.getElementById('err').textContent = 'Enter a public GitHub repository, like vercel/next.js, or paste a github.com link.'; return; }
  location.href = '/' + repo + '/';
};
document.querySelectorAll('[data-host]').forEach(function (el) { el.textContent = location.host; });
typewriter(document.getElementById('repo'), ['vercel/next.js', 'tanstack/query', 'oven-sh/bun', 'reactjs/react.dev', 'flisk-sh/flisk', 'your-org/your-repo'], 'github.com/');
// Every [data-copy] button copies the text of the element its selector names.
document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.onclick = function () {
    var text = document.querySelector(b.getAttribute('data-copy')).textContent;
    navigator.clipboard.writeText(text).then(function () { b.textContent = 'Copied'; }, function () { b.textContent = 'Copy failed'; });
    setTimeout(function () { b.textContent = 'Copy'; }, 1500);
  };
});
document.getElementById('copytry').onclick = function () {
  var b = this; navigator.clipboard.writeText(location.origin + '/vercel/next.js/').then(function () { b.textContent = 'Copied'; }, function () { b.textContent = 'Copy failed'; });
  setTimeout(function () { b.textContent = 'Copy'; }, 1500);
};
document.querySelectorAll('[data-mcp]').forEach(function (el) { el.textContent = 'claude mcp add --transport http nextjs ' + location.origin + '/vercel/next.js/mcp'; });
`;

function examples(): string {
  return EXAMPLES.map(
    (e) =>
      `<a class="ex" href="/${e.path}/"><img class="exav" src="https://github.com/${e.owner}.png?size=72" alt="" width="36" height="36"><div><div class="name mono">${e.name}</div><div class="note">${e.note}</div></div></a>`,
  ).join('');
}

export const landingPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head(SITE_BASE, { path: '', title: `${SITE.name}: ${SITE.tagline}`, description: SITE.description })}
<style>${css}${landingCss}</style>
</head>
<body>
<div class="stage"><div class="wrap">
  <nav class="nav">
    <a class="brand" href="/"><span class="mark">H</span>Helpdock</a>
    <div class="navlinks"><a href="#how">How it works</a><a href="https://github.com/flisk-sh/helpdock">GitHub</a></div>
  </nav>
  <section class="hero">
    <span class="eyebrow">Open source · No signup · No API key</span>
    <h1>Any GitHub repo's docs, as a <span class="grad">help center</span>.</h1>
    <p class="lede">Search and browse a repository's Markdown, get answers quoted from the exact page with a link to it on GitHub, and give the same docs to your own AI over MCP.</p>
    <div class="swap">
      <div class="from mono"><s>github.com</s>/vercel/next.js</div>
      <div class="to"><a class="mono" id="tryurl" href="/vercel/next.js/"><b data-host>helpdock.flisk.sh</b>/vercel/next.js</a><button class="ghost" id="copytry" type="button">Copy</button></div>
    </div>
    <form class="open" id="open"><div class="row"><input class="field mono" id="repo" autocomplete="off" spellcheck="false" placeholder="github.com/owner/repo" aria-label="GitHub repository"><button class="btn">Open help center</button></div><div class="err" id="err"></div></form>
    <div class="examples">${examples()}</div>
    <figure class="demo"><div class="chrome" aria-hidden="true"><i></i><i></i><i></i></div><img class="still" src="/demo.jpg" width="960" height="540" alt=""><video src="/demo.mp4" poster="/demo.jpg" width="960" height="540" autoplay muted loop playsinline preload="metadata" aria-describedby="demo-text"></video>
    <figcaption id="demo-text" class="sr">A 23-second film: github.com is replaced with helpdock.flisk.sh in the address of vercel/next.js, its docs open as a help center, the question "How do I add middleware?" is answered with passages quoted from the docs and links to them on GitHub, and the "Use in your AI" panel shows the MCP address.</figcaption></figure>
  </section>
</div></div>
<div class="wrap">
  <section class="grid3">
    <div class="card"><h3>A help center</h3><p>Ask in your own words. Answers are passages quoted from the docs, each linked to its file and heading on GitHub. Every page is browsable.</p></div>
    <div class="card"><h3>An MCP server for your AI</h3><p>Every repository gets one at <span class="mono">/owner/repo/mcp</span>, for Claude, ChatGPT, Cursor or Codex:</p><div class="codebox"><pre class="mono" data-mcp>claude mcp add --transport http nextjs https://helpdock.flisk.sh/vercel/next.js/mcp</pre><button class="ghost" type="button" data-copy="[data-mcp]">Copy</button></div></div>
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
<script>${typewriterJs}${landingJs}</script>
</body>
</html>`;

const centerCss = String.raw`
.top { position:sticky; top:0; z-index:5; border-bottom:1px solid var(--line); overflow:visible; }
.top.stage::before, .top.stage::after { display:none; }
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
#ask.compact h1, #ask.compact .sub, #ask.compact .chips { display:none; }
/* On every view but the home one the question box stays under the header while the page scrolls. */
#ask.compact { position:sticky; top:58px; z-index:4; background:var(--bg); padding:10px 0 12px; margin:0 0 14px; }
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
details.fold > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:6px; font-size:13.5px; font-weight:600; padding:6px 8px; border-radius:7px; color:var(--ink); }
details.fold > summary::-webkit-details-marker { display:none; }
details.fold > summary::before { content:'\203A'; display:inline-block; width:10px; color:var(--muted); transition:transform .15s; }
details.fold[open] > summary::before { transform:rotate(90deg); }
details.fold > summary:hover { background:var(--tint); }
details.fold > summary .n { margin-left:auto; font-size:11.5px; font-weight:500; color:var(--muted); }
details.fold .kids { margin-left:10px; padding-left:6px; border-left:1px solid var(--line); }
details.fold.more { margin-top:14px; border-top:1px solid var(--line); padding-top:8px; }
details.fold.more > summary { color:var(--muted); }
.side a.pg .pp { display:block; font-size:11.5px; color:var(--muted); font-family:ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap:anywhere; }
.avatar { width:22px; height:22px; border-radius:6px; flex:none; background:var(--line); }
.label-sm { font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:34px 0 10px; }
.cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px; }
.pcard { display:block; text-decoration:none; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px 16px; transition:border-color .15s, transform .15s; }
.pcard:hover { border-color:var(--accent); transform:translateY(-1px); }
.pcard .ct { font-weight:650; margin-bottom:4px; overflow-wrap:anywhere; }
.pcard.nolead .cs { display:none; }
.pcard .cs { font-size:14px; color:var(--muted); line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
@media (prefers-reduced-motion: reduce) { .pcard, details.fold > summary::before { transition:none; } }
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
var info = null, pages = [], current = null, readmeShown = false, typing = false;
// While the index builds, the README comes straight from GitHub so there is something to read at once.
// Search is open while the last pages are added: show the count, and reload the page list once it is complete.
function followIndexing() {
  setStatus('Indexing… ' + (info.files || 0) + ' pages');
  setTimeout(function () {
    api('status').then(function (s) {
      info = s;
      if (s.indexing) return followIndexing();
      setStatus((s.files ? s.files + ' pages' : s.sections + ' sections') + (s.sha && /^[0-9a-f]{7,}$/.test(s.sha) ? ' · ' + s.sha.slice(0, 7) : ''));
      loadPages();
    }).catch(function () { setTimeout(followIndexing, 3000); });
  }, 2000);
}
function showReadme() {
  readmeShown = 'loading';
  api('readme').then(function (r) {
    if (info && info.status === 'ready') return;
    readmeShown = 'shown';
    $('article').hidden = false; $('start').hidden = true;
    var box = $('article'); box.textContent = '';
    var head = el('div', 'p mono muted', r.source); box.append(head);
    var gh = el('a', 'ghost', 'Open on GitHub ↗'); gh.href = r.url; gh.target = '_blank'; gh.rel = 'noopener'; gh.style.marginTop = '8px'; box.append(gh);
    var md = el('div', 'md'); md.style.marginTop = '14px'; md.innerHTML = r.html; box.append(md);
  }).catch(function () { readmeShown = 'none'; });
}
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
    if (s.kind === 'repo') { var av = $('avatar'); av.src = 'https://github.com/' + s.label.split('/')[0] + '.png?size=64'; av.hidden = false; }
    // A folder's heading is the folder ("terraform/v1.17.x"), the header keeps the whole address.
    $('title').textContent = 'Ask the ' + (s.label.indexOf(' › ') > 0 ? s.label.split(' › ')[1] : s.label) + ' docs';
    if (s.status === 'building') {
      var p = s.progress || { files: 0 };
      setStatus(s.queued ? 'Waiting…' : 'Indexing…');
      $('loadmsg').textContent = s.queued
        ? 'Waiting for its turn to be indexed (other repositories first). Here is the README meanwhile.'
        : 'Indexing the docs for search' + (p.files ? ': ' + p.files + ' pages so far' : '') + '. Here is the README meanwhile.';
      $('loading').hidden = false;
      if (!readmeShown && s.kind === 'repo') showReadme();
      return setTimeout(boot, 1500);
    }
    $('loading').hidden = true;
    if (readmeShown === 'shown' && !location.hash) { showView('answers', true); }
    if (s.status === 'error') {
      setStatus('Unavailable', true);
      $('fatal').hidden = false;
      $('fatalmsg').textContent = s.error || 'This repository could not be read.';
      return;
    }
    setStatus((s.files ? s.files + ' pages' : s.sections + ' sections') + (s.sha && /^[0-9a-f]{7,}$/.test(s.sha) ? ' · ' + s.sha.slice(0, 7) : ''));
    if (s.truncated) $('pill').title = 'The largest repositories are indexed up to ' + s.files + ' pages, docs first.';
    $('mcpurl').textContent = s.mcpUrl;
    var folder = s.label.indexOf(' › ') > 0 ? s.label.split(' › ')[1].split('/')[0] : '';
    var name = (folder || s.label.split('/').pop() || 'docs').replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase();
    $('mcpcc').textContent = 'claude mcp add --transport http ' + name + ' ' + s.mcpUrl;
    var servers = {}; servers[name] = { url: s.mcpUrl };
    $('mcpjson').textContent = JSON.stringify({ mcpServers: servers }, null, 2);
    $('ask').hidden = false;
    loadPages();

    var hash = decodeURIComponent(location.hash.slice(1));
    if (hash.indexOf('page=') === 0) openPage(hash.slice(5));
    else if (hash.indexOf('q=') === 0) ask(hash.slice(2));
    else if (hash === 'mcp') $('mcp').hidden = false; // a link straight to "Use in your AI"
    // No autofocus: the typing placeholder shows the kind of question to ask; a click starts.
  }).catch(function (e) {
    // Busy or a dropped connection: keep the name and the README on screen and try again; only a real error stops.
    var parts = base.split('/').filter(Boolean);
    if (parts.length === 2) { $('label').textContent = parts.join('/'); $('label').href = 'https://github.com/' + parts.join('/'); }
    if (e.status === 503 || !e.status) {
      setStatus('Waiting…');
      $('loadmsg').textContent = 'Waiting for its turn to be indexed. Here is the README meanwhile.';
      $('loading').hidden = false;
      if (!readmeShown && parts.length === 2) showReadme();
      return setTimeout(boot, 3000);
    }
    setStatus('Unavailable', true);
    $('loading').hidden = true;
    $('fatal').hidden = false;
    $('fatalmsg').textContent = e.message || 'Could not load this help center.';
  });
}

function dirOfSource(s) { return s.indexOf('/') === -1 ? '' : s.slice(0, s.lastIndexOf('/')); }
function baseName(s) { return s.split('/').pop().replace(/\.(md|mdx|markdown|rst|txt)$/i, '').replace(/^\d+[-_.]/, '').toLowerCase(); }
// "01-app" → "App", "api-reference" → "API reference": folder names as people would write them.
function prettySegment(seg) {
  var t = seg.replace(/^\d+[-_.]/, '').replace(/[-_]+/g, ' ').trim();
  t = t.replace(/\b(api|cli|mcp|ui|ssr|sdk|faq|css|js|ts|ai|llm|llms)\b/gi, function (w) { return w.toUpperCase(); });
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : seg;
}

// The page list as a folder tree. A folder is named by its index or README page when it has one ("App Router"),
// else by its prettied name; folders with doc pages come first and open, the rest fold into "Everything else".
function buildTree(list) {
  var root = { name: '', path: '', label: '', kids: {}, pages: [], best: -99, count: 0 };
  list.forEach(function (p) {
    var node = root;
    var dir = dirOfSource(p.rel || p.source);
    (dir ? dir.split('/') : []).forEach(function (seg) {
      if (!node.kids[seg]) node.kids[seg] = { name: seg, path: node.path ? node.path + '/' + seg : seg, label: prettySegment(seg), kids: {}, pages: [], best: -99, count: 0 };
      node = node.kids[seg];
    });
    node.pages.push(p);
  });
  (function walk(n) {
    n.pages.forEach(function (p) {
      n.best = Math.max(n.best, p.priority || 0);
      if (/^(index|readme)$/.test(baseName(p.source)) && n !== root) n.label = p.title;
    });
    n.count = n.pages.length;
    Object.keys(n.kids).forEach(function (k) { var c = n.kids[k]; walk(c); n.best = Math.max(n.best, c.best); n.count += c.count; });
  })(root);
  return root;
}
// Doc folders first, the biggest first ("Next.js Docs" with 460 pages before "Contributing" with 14), then by name.
function isDocFolder(n) { return n.best >= 4; }
function sortedKids(n) {
  return Object.keys(n.kids).map(function (k) { return n.kids[k]; }).sort(function (a, b) {
    return (isDocFolder(b) - isDocFolder(a)) || (isDocFolder(a) ? b.count - a.count : 0) || a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}
function pageLink(p, showPath) {
  var a = el('a', 'pg' + (current === p.source ? ' on' : ''), p.title);
  a.href = '#page=' + encodeURIComponent(p.source);
  a.title = p.source;
  if (showPath) a.append(el('span', 'pp', p.source));
  a.onclick = function (e) { e.preventDefault(); openPage(p.source); };
  return a;
}
var openFirst = {};
function renderNode(n, depth, box) {
  n.pages.slice().sort(function (a, b) { return ((b.priority || 0) - (a.priority || 0)) || a.source.localeCompare(b.source, undefined, { numeric: true }); })
    .forEach(function (p) { box.append(pageLink(p)); });
  sortedKids(n).forEach(function (k) {
    var d = el('details', 'fold'); d.style.setProperty('--depth', depth);
    var holdsCurrent = current && current.indexOf(k.path + '/') === 0;
    if (depth === 0 && isDocFolder(k) && openFirst.done !== true) { d.open = true; openFirst.done = true; }
    if (holdsCurrent) d.open = true;
    var sum = el('summary', null, k.label); sum.append(el('span', 'n', String(k.count))); d.append(sum);
    var inner = el('div', 'kids'); renderNode(k, depth + 1, inner); d.append(inner);
    box.append(d);
  });
}
function renderSide(filter) {
  var box = $('tree'); box.textContent = '';
  var f = filter.trim().toLowerCase();
  if (f) {
    var hits = pages.filter(function (p) { return (p.title + ' ' + p.source).toLowerCase().indexOf(f) !== -1; })
      .sort(function (a, b) { return ((b.priority || 0) - (a.priority || 0)) || a.title.localeCompare(b.title); });
    hits.slice(0, 200).forEach(function (p) { box.append(pageLink(p, true)); });
    $('count').textContent = hits.length + ' of ' + pages.length + ' pages';
    return;
  }
  var root = buildTree(pages);
  openFirst = {};
  // Top-level pages with doc priority (README) first, then the doc folders open, then everything else folded.
  var docs = el('div'), rest = el('div');
  root.pages.filter(function (p) { return (p.priority || 0) > 0; }).forEach(function (p) { docs.append(pageLink(p)); });
  var others = root.pages.filter(function (p) { return (p.priority || 0) <= 0; });
  var restCount = others.length;
  sortedKids(root).forEach(function (k) {
    var holder = { name: '', kids: {}, pages: [] }; holder.kids[k.name] = k;
    if (isDocFolder(k)) renderNode(holder, 0, docs); else { renderNode(holder, 1, rest); restCount += k.count; }
  });
  others.forEach(function (p) { rest.prepend(pageLink(p)); });
  box.append(docs);
  if (restCount > 0) {
    var d = el('details', 'fold more'); var sum = el('summary', null, 'Everything else'); sum.append(el('span', 'n', String(restCount)));
    d.append(sum, rest); box.append(d);
  }
  $('count').textContent = pages.length + ' pages';
}
function loadPages() {
  api('pages').then(function (b) { pages = b.pages; renderSide(''); renderStart(); });
}

// "Start here": the pages a newcomer reads first, as cards with their lead sentence. Chosen by the file's own name
// (installation.mdx, getting-started.md, ...), in this order, then other short-titled doc pages.
function startPicks() {
  var topics = [/^(getting-started|quick-?start|introduction|intro|overview|index|readme)$/, /^install(ation|ing)?$/, /^(project-structure|structure|concepts?)$/, /^(routing|basics|usage|tutorial|guide)$/, /^(configuration|config|configuring|settings)$/, /^(deploy(ing|ment)?|production)$/, /^(api|api-reference|reference|cli)$/, /^(faq|troubleshoot(ing)?)$/];
  var repoName = (info && info.label ? info.label.split('/').pop() : '').toLowerCase();
  // Without an index the pages carry no lead; the cards fetch them (see renderStart). Titles come from file names.
  var usable = function (p) { return (!p.summary || (p.summary.length >= 40 && !/^[\w./-]+\.mdx?$/i.test(p.summary))) && !/^readme$/i.test(p.title); };
  var good = pages.filter(function (p) { return (p.priority || 0) >= 4 && p.title.length <= 40 && p.title.toLowerCase() !== repoName && usable(p); });
  var picks = [];
  topics.forEach(function (re) {
    var hit = good.filter(function (p) { return re.test(baseName(p.source)) && picks.indexOf(p) === -1; })
      .sort(function (a, b) { return a.source.split('/').length - b.source.split('/').length; })[0];
    if (hit) picks.push(hit);
  });
  good.sort(function (a, b) { return a.source.split('/').length - b.source.split('/').length || a.source.localeCompare(b.source, undefined, { numeric: true }); })
    .forEach(function (p) { if (picks.length < 6 && picks.indexOf(p) === -1) picks.push(p); });
  if (picks.length < 3) pages.filter(function (p) { return usable(p) && picks.indexOf(p) === -1; }).slice(0, 6 - picks.length).forEach(function (p) { picks.push(p); });
  return picks.slice(0, 6);
}
function renderStart() {
  var picks = startPicks();
  var box = $('start'); box.textContent = '';
  if (!picks.length) return;
  box.append(el('div', 'label-sm', 'Start here'));
  var grid = el('div', 'cards');
  var chipOf = {};
  var phrases = picks.map(function (p) { return p.title; });
  picks.forEach(function (p, n) {
    var c = el('a', 'pcard'); c.href = '#page=' + encodeURIComponent(p.source);
    c.onclick = function (e) { e.preventDefault(); openPage(p.source); };
    var cs = el('div', 'cs', p.summary || '');
    var ct = el('div', 'ct', p.title);
    c.append(ct, cs);
    grid.append(c);
    // Without an index a page's title is its file name ("Cli"); its real title and lead come from the page itself.
    if (!p.summary) api('lead?source=' + encodeURIComponent(p.source)).then(function (r) {
      if (r.title) { ct.textContent = r.title; p.title = r.title; phrases[n] = r.title; if (chipOf[n]) { chipOf[n].textContent = r.title; } }
      if (r.lead) cs.textContent = r.lead; else c.classList.add('nolead');
    }).catch(function () {});
  });
  box.append(grid);
  // The question box types this repository's own topics as examples.
  if (!typing) { typing = true; typewriter($('q'), phrases, 'Ask about '); }
  // Suggested questions: the same topics, phrased as one.
  var chips = $('chips'); chips.textContent = '';
  picks.slice(0, 4).forEach(function (p, n) {
    var b = el('button', 'chip', p.title); b.type = 'button'; b.onclick = function () { ask(b.textContent); };
    chipOf[n] = b;
    chips.append(b);
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
  var first = info && info.kind === 'repo' && !info.indexed;
  var wait = el('div', 'loading'); wait.append(el('div', 'spin'), el('span', null, first ? 'Indexing the docs for your first question (a few seconds)…' : 'Searching the docs…')); box.append(wait);
  $('go').disabled = true;
  api('turn', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': sid }, body: JSON.stringify({ input: question }) })
    .then(function (b) {
      wait.remove();
      if (info) info.indexed = true;
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
        // s.html is sanitized on the server (md2html: allowlisted tags, no scripts or handlers, URLs resolved).
        var body = el('div', 'md'); body.innerHTML = s.html;
        card.append(head, body); box.append(card);
      });
      box.append(aiRow(b.prompt));
    })
    .catch(function (e) {
      wait.remove();
      if (e.status === 503) { box.append(el('div', 'none', 'Still indexing this repository, asking again…')); return setTimeout(function () { ask(question); }, 3000); }
      box.append(el('div', 'none', e.status === 429 ? 'Too many questions from here; wait a little.' : 'Something went wrong: ' + e.message));
    })
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
    var back = el('a', 'back', '← Ask a question'); back.href = '#'; back.onclick = function (e) { e.preventDefault(); showView('answers', true); $('answers').textContent = ''; history.replaceState(null, '', location.pathname); $('q').focus(); };
    box.append(back, el('h2', null, p.title), el('div', 'p mono muted', source));
    if (p.url) { var gh = el('a', 'ghost', 'Open on GitHub ↗'); gh.href = p.url; gh.target = '_blank'; gh.rel = 'noopener'; gh.style.marginTop = '10px'; box.append(gh); }
    var target = null;
    p.sections.forEach(function (s) {
      if (s.section) { var h = el('h3', null, s.section); box.append(h); if (s.section === section) target = h; }
      var md = el('div', 'md'); md.innerHTML = s.html; box.append(md);
    });
    if (target) target.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
    if (window.innerWidth < 860) $('side').classList.remove('open');
  }).catch(function (e) { box.textContent = ''; box.append(el('div', 'none', 'Could not open this page: ' + e.message)); });
}

function showView(which, home) { $('answers').hidden = which !== 'answers'; $('article').hidden = which !== 'article'; $('ask').hidden = false; $('ask').classList.toggle('compact', !home); $('start').hidden = !home; }

$('f').onsubmit = function (e) { e.preventDefault(); ask($('q').value); };
// The search index is built for the first question only; start it when the visitor starts typing, so it is ready by Ask.
var warmed = false;
function warm() { if (warmed || !info || info.kind !== 'repo' || info.indexed) return; warmed = true; api('warm', { method: 'POST' }).catch(function () { warmed = false; }); }
$('q').addEventListener('focus', warm);
$('q').addEventListener('input', warm);
$('filter').oninput = function () { renderSide($('filter').value); };
$('mcpbtn').onclick = function () { $('mcp').hidden = !$('mcp').hidden; };
$('copymcp').onclick = function () { copy($('mcpurl').textContent, $('copymcp')); };
$('copycc').onclick = function () { copy($('mcpcc').textContent, $('copycc')); };
$('copyjson').onclick = function () { copy($('mcpjson').textContent, $('copyjson')); };
$('pagesbtn').onclick = function () { $('side').classList.toggle('open'); };
boot();
`;

/** A help center page with its own title, description and canonical address; the script is the same on every one. */
export const centerPageFor = (meta: PageMeta) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head(SITE_BASE, meta)}
<style>${css}${centerCss}</style>
</head>
<body>
<div class="top stage"><div class="wrap">
  <div class="crumb"><a class="brand" href="/"><span class="mark">H</span><span class="hide-sm">Helpdock</span></a><span class="sep">/</span><img class="avatar" id="avatar" alt="" width="22" height="22" hidden><a class="label mono" id="label" target="_blank" rel="noopener">…</a><span class="pill" id="pill">Loading…</span></div>
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
      <div class="k">Cursor, Windsurf and other clients (mcp.json):</div><pre class="mono" id="mcpjson"></pre><button class="ghost" id="copyjson" type="button">Copy JSON</button>
    </section>
    <div class="loading" id="loading" hidden><div class="spin"></div><span id="loadmsg">Reading the repository…</span></div>
    <div id="fatal" hidden><h1>Can't open this one</h1><p class="sub" id="fatalmsg"></p><a class="ghost" href="/">Try another repository</a></div>
    <section id="ask" hidden>
      <h1 id="title">Ask the docs</h1>
      <p class="sub">Answers are passages quoted from the docs, linked to the exact page. Hand them to your own AI for a written answer.</p>
      <form id="f" class="row"><input class="field" id="q" autocomplete="off" placeholder="Ask in your own words, e.g. how do I install it?" aria-label="Question" maxlength="500"><button class="btn" id="go">Ask</button></form>
      <div class="chips" id="chips"></div>
    </section>
    <section id="start"></section>
    <section id="answers"></section>
    <section id="article" class="article" hidden></section>
  </main>
</div>
<script>${typewriterJs}${centerJs}</script>
</body>
</html>`;

export const centerPage = centerPageFor({
  path: 'docs/',
  title: 'Docs',
  description: "Search, browse and ask this deployment's docs, with answers quoted from the exact page. Also an MCP server for your AI.",
});
