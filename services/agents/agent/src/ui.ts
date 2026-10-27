// The help center page served at GET /. One file, no build step: it posts to ./turn and ./search next to itself,
// so it works behind a Traefik path prefix as well as on the agent's own port.
export const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Helpdock</title>
<style>
  :root { --bg:#f7f6f3; --card:#fff; --ink:#1d1d1b; --muted:#6b6a65; --line:#e4e2dc; --accent:#0f766e; --chip:#eef6f5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141413; --card:#1e1e1c; --ink:#ecebe6; --muted:#9a998f; --line:#2e2d2a; --accent:#5eead4; --chip:#17302d; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { max-width:760px; margin:0 auto; padding:56px 16px 120px; }
  h1 { font-size:32px; letter-spacing:-.02em; margin:0 0 6px; }
  .sub { color:var(--muted); margin:0 0 28px; }
  form { display:flex; gap:8px; position:sticky; top:12px; z-index:1; }
  input { flex:1; font:inherit; padding:14px 16px; border:1px solid var(--line); border-radius:12px; background:var(--card); color:var(--ink); }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  button { font:inherit; font-weight:600; padding:0 20px; border:0; border-radius:12px; background:var(--accent); color:var(--bg); cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  .ideas { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 0; }
  .ideas a { font-size:14px; padding:6px 12px; border-radius:999px; background:var(--chip); color:var(--accent); text-decoration:none; cursor:pointer; }
  .turn { margin-top:28px; }
  .q { font-weight:600; margin-bottom:10px; }
  .a { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; white-space:pre-wrap; }
  .a sup a { color:var(--accent); text-decoration:none; font-weight:600; }
  .src { list-style:none; padding:0; margin:12px 0 0; display:grid; gap:6px; }
  .src li { font-size:14px; color:var(--muted); }
  .src b { color:var(--accent); margin-right:6px; }
  .thinking { color:var(--muted); }
  footer { margin-top:48px; font-size:13px; color:var(--muted); }
  footer a { color:var(--accent); }
  .pill { font:inherit; font-size:14px; font-weight:500; padding:5px 12px; border-radius:999px; border:1px solid var(--line); background:var(--card); color:var(--ink); text-decoration:none; cursor:pointer; }
  .pill:hover { border-color:var(--accent); }
  .ai { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:12px 0 0; font-size:14px; color:var(--muted); }
  .mcp { margin:24px 0 0; padding:12px 16px; border:1px dashed var(--line); border-radius:12px; font-size:14px; color:var(--muted); display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .mcp code { background:var(--chip); color:var(--accent); padding:2px 8px; border-radius:6px; overflow-wrap:anywhere; }
</style>
</head>
<body>
<main>
  <h1>How can we help?</h1>
  <p class="sub">Ask in your own words. Every answer quotes the pages it came from, and you can hand it to your own AI.</p>
  <form id="f"><input id="q" autocomplete="off" placeholder="e.g. How do I fix a port that is already in use?" autofocus><button id="go">Ask</button></form>
  <div class="ideas" id="ideas"></div>
  <div class="mcp">Use these docs in your own AI: add <code id="mcpurl"></code> as an MCP server in Claude, ChatGPT, Cursor or Codex. <button class="pill" id="copymcp" type="button">Copy</button></div>
  <div id="log"></div>
  <footer>Open source: <a href="https://github.com/flisk-sh/helpdock">flisk-sh/helpdock</a>. Built and run with <a href="https://github.com/flisk-sh/flisk">Flisk</a>.</footer>
</main>
<script>
const base = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
const sid = (() => { try { return localStorage.getItem('helpdock-sid') || (localStorage.setItem('helpdock-sid', crypto.randomUUID()), localStorage.getItem('helpdock-sid')); } catch { return crypto.randomUUID(); } })();
const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
// Copies text; says so on the button for a moment.
async function copy(text, btn) {
  const label = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; } catch { btn.textContent = 'Copy failed'; }
  setTimeout(() => { btn.textContent = label; }, 1500);
}
function pill(tag, label) { const el = document.createElement(tag); el.className = 'pill'; el.textContent = label; if (tag === 'button') el.type = 'button'; return el; }
const mcpUrl = location.origin + base + 'mcp';
$('mcpurl').textContent = mcpUrl;
$('copymcp').onclick = () => copy(mcpUrl, $('copymcp'));

// "Ask your AI": the visitor's own assistant writes the answer from the cited passages. ChatGPT takes the prompt in
// its URL; Claude's prefill is not reliable, so its button copies the prompt first, then opens Claude to paste it.
function askYourAi(prompt) {
  const row = document.createElement('div'); row.className = 'ai';
  row.append('Ask your AI:');
  const chatgpt = pill('a', 'ChatGPT');
  chatgpt.href = 'https://chatgpt.com/?q=' + encodeURIComponent(prompt); chatgpt.target = '_blank'; chatgpt.rel = 'noopener';
  const claude = pill('button', 'Claude');
  claude.onclick = async () => { await copy(prompt, claude); window.open('https://claude.ai/new?q=' + encodeURIComponent(prompt), '_blank', 'noopener'); };
  const other = pill('button', 'Copy prompt');
  other.onclick = () => copy(prompt, other);
  row.append(chatgpt, claude, other);
  return row;
}

['How do I fix a port that is already in use?', 'Bring my own Docker image', 'Run Flisk on Windows', 'How do agents keep sessions?']
  .forEach((t) => { const a = document.createElement('a'); a.textContent = t; a.onclick = () => ask(t); $('ideas').append(a); });

async function ask(question) {
  question = question.trim();
  if (!question) return;
  $('q').value = ''; $('go').disabled = true;
  const turn = document.createElement('div'); turn.className = 'turn';
  turn.innerHTML = '<div class="q">' + esc(question) + '</div><div class="a thinking">Searching the docs…</div>';
  $('log').prepend(turn);
  try {
    const r = await fetch(base + 'turn', { method:'POST', headers:{ 'content-type':'application/json', 'x-session-id':sid }, body:JSON.stringify({ input:question }) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.status);
    const id = 't' + Date.now();
    const a = turn.querySelector('.a'); a.classList.remove('thinking');
    a.innerHTML = esc(body.reply).replace(/\\[(\\d+)\\]/g, (m, n) => '<sup><a href="#' + id + '-' + n + '">[' + n + ']</a></sup>');
    if (body.sources.length) {
      const ul = document.createElement('ul'); ul.className = 'src';
      ul.innerHTML = body.sources.map((s) => '<li id="' + id + '-' + s.n + '"><b>[' + s.n + ']</b>' + esc(s.title) + (s.section ? ' › ' + esc(s.section) : '') + ' <small>(' + esc(s.source) + ')</small></li>').join('');
      a.after(ul);
      ul.after(askYourAi(body.prompt));
    }
  } catch (e) {
    turn.querySelector('.a').textContent = 'Something went wrong: ' + e.message;
  } finally { $('go').disabled = false; $('q').focus(); }
}
$('f').onsubmit = (e) => { e.preventDefault(); ask($('q').value); };
</script>
</body>
</html>`;
