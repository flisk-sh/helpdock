// The 13-second "how it works" clip on the landing page and in the README, drawn frame by frame as SVG (no screen
// recording, so it is sharp, small and the same on every run). Run it after changing a scene:
//   bun run video
// Writes src/video.generated.ts (MP4 and a poster, served at /demo.mp4 and /demo.jpg) and docs/demo.gif at the
// repository root. Needs ffmpeg on the PATH.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const W = 960;
const H = 540;
const FPS = 25;
const DURATION = 13;
const here = new URL('..', import.meta.url).pathname;

const C = { bg: '#f6f5f1', ink: '#17171a', muted: '#66655f', line: '#e3e1da', panel: '#ffffff', accent: '#0d7a62', tint: '#e6f2ee' };
const SANS = 'Helvetica, Arial, sans-serif';
const MONO = 'Menlo, monospace';

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** 0 → 1 between `from` and `to` seconds, eased. */
const ease = (t: number, from: number, to: number) => {
  const x = clamp((t - from) / (to - from));
  return x * x * (3 - 2 * x);
};
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
const typed = (text: string, t: number, from: number, seconds: number) => text.slice(0, Math.floor(clamp((t - from) / seconds) * text.length));

function caption(text: string) {
  return `<rect x="0" y="${H - 64}" width="${W}" height="64" fill="${C.ink}"/><text x="${W / 2}" y="${H - 24}" text-anchor="middle" font-family="${SANS}" font-size="26" font-weight="700" fill="${C.bg}">${esc(text)}</text>`;
}

const PAGES = ['Getting started', 'Installation', 'Project structure', 'Routing', 'Middleware', 'Data fetching', 'Caching', 'Deploying'];

function frame(t: number): string {
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${C.bg}"/>`];
  if (t < 3.4) {
    // 1. github.com is struck through and replaced.
    const strike = ease(t, 0.5, 1.0);
    const host = typed('helpdock.flisk.sh', t, 1.2, 1.4);
    parts.push(`<rect x="80" y="150" width="800" height="72" rx="36" fill="${C.panel}" stroke="${C.line}" stroke-width="2"/>`);
    const hostX = 120;
    if (host) {
      parts.push(`<text x="${hostX}" y="197" font-family="${MONO}" font-size="30"><tspan fill="${C.accent}" font-weight="700">${esc(host)}</tspan><tspan fill="${C.ink}">/vercel/next.js</tspan></text>`);
    } else {
      parts.push(`<text x="${hostX}" y="197" font-family="${MONO}" font-size="30" fill="${C.muted}">github.com<tspan fill="${C.ink}">/vercel/next.js</tspan></text>`);
      parts.push(`<line x1="${hostX}" y1="187" x2="${hostX + 180 * strike}" y2="187" stroke="${C.ink}" stroke-width="3"/>`);
    }
    parts.push(`<text x="${W / 2}" y="320" text-anchor="middle" font-family="${SANS}" font-size="40" font-weight="800" fill="${C.ink}" opacity="${ease(t, 2.6, 3.1)}">Any public GitHub repository</text>`);
    parts.push(caption('Replace github.com with helpdock.flisk.sh'));
  } else if (t < 6.6) {
    // 2. A help center: the page tree and the README.
    const s = t - 3.4;
    parts.push(`<text x="60" y="70" font-family="${SANS}" font-size="26" font-weight="800" fill="${C.ink}">vercel/next.js</text><rect x="270" y="48" width="96" height="30" rx="15" fill="${C.tint}"/><text x="318" y="69" text-anchor="middle" font-family="${SANS}" font-size="16" font-weight="700" fill="${C.accent}">470 pages</text>`);
    parts.push(`<rect x="60" y="100" width="250" height="360" rx="12" fill="${C.panel}" stroke="${C.line}" stroke-width="2"/>`);
    PAGES.forEach((p, i) => {
      parts.push(`<text x="84" y="${142 + i * 40}" font-family="${SANS}" font-size="20" fill="${i === 0 ? C.accent : C.ink}" font-weight="${i === 0 ? 700 : 400}" opacity="${ease(s, 0.1 + i * 0.12, 0.4 + i * 0.12)}">${p}</text>`);
    });
    parts.push(`<g opacity="${ease(s, 0.6, 1.1)}"><rect x="330" y="100" width="570" height="360" rx="12" fill="${C.panel}" stroke="${C.line}" stroke-width="2"/>
<text x="360" y="150" font-family="${SANS}" font-size="30" font-weight="800" fill="${C.ink}">Getting started</text>
<rect x="360" y="180" width="500" height="12" rx="6" fill="${C.line}"/><rect x="360" y="206" width="460" height="12" rx="6" fill="${C.line}"/><rect x="360" y="232" width="480" height="12" rx="6" fill="${C.line}"/>
<rect x="360" y="276" width="510" height="70" rx="10" fill="${C.bg}"/><text x="380" y="318" font-family="${MONO}" font-size="20" fill="${C.ink}">npx create-next-app@latest</text>
<rect x="360" y="370" width="440" height="12" rx="6" fill="${C.line}"/><rect x="360" y="396" width="380" height="12" rx="6" fill="${C.line}"/></g>`);
    parts.push(caption("A help center for its docs, ready to browse"));
  } else if (t < 10.2) {
    // 3. A question, answered with a quote from the exact page.
    const s = t - 6.6;
    const q = typed('How do I add middleware?', s, 0.1, 1.0);
    parts.push(`<rect x="80" y="70" width="800" height="64" rx="14" fill="${C.panel}" stroke="${C.accent}" stroke-width="2"/><text x="108" y="112" font-family="${SANS}" font-size="26" fill="${C.ink}">${esc(q)}</text>`);
    parts.push(`<rect x="770" y="80" width="96" height="44" rx="10" fill="${C.accent}"/><text x="818" y="109" text-anchor="middle" font-family="${SANS}" font-size="20" font-weight="700" fill="#ffffff">Ask</text>`);
    const a = ease(s, 1.5, 2.0);
    parts.push(`<g opacity="${a}" transform="translate(0 ${(1 - a) * 12})"><rect x="80" y="160" width="800" height="240" rx="14" fill="${C.panel}" stroke="${C.line}" stroke-width="2"/>
<rect x="80" y="160" width="6" height="240" fill="${C.accent}"/>
<text x="112" y="206" font-family="${SANS}" font-size="22" fill="${C.ink}">“Create a <tspan font-weight="700">middleware.ts</tspan> file in the root of your</text>
<text x="112" y="240" font-family="${SANS}" font-size="22" fill="${C.ink}">project to define Middleware…”</text>
<text x="112" y="300" font-family="${SANS}" font-size="18" fill="${C.muted}">Source</text>
<text x="112" y="332" font-family="${MONO}" font-size="18" fill="${C.accent}">docs/01-app/…/middleware.mdx ↗</text>
<text x="112" y="372" font-family="${SANS}" font-size="18" fill="${C.muted}">Quoted from the docs, not made up. No model, no API key.</text></g>`);
    parts.push(caption('Answers quoted from the exact page, with the link'));
  } else {
    // 4. The same docs in your own AI.
    const s = t - 10.2;
    parts.push(`<text x="${W / 2}" y="160" text-anchor="middle" font-family="${SANS}" font-size="36" font-weight="800" fill="${C.ink}">Give the docs to your AI</text>`);
    parts.push(`<g opacity="${ease(s, 0.2, 0.6)}"><rect x="80" y="210" width="800" height="70" rx="12" fill="${C.ink}"/><text x="108" y="254" font-family="${MONO}" font-size="19" fill="${C.bg}">claude mcp add --transport http next \\</text></g>`);
    parts.push(`<g opacity="${ease(s, 0.5, 0.9)}"><rect x="80" y="286" width="800" height="60" rx="12" fill="${C.ink}"/><text x="108" y="324" font-family="${MONO}" font-size="19" fill="${C.bg}">  https://helpdock.flisk.sh/vercel/next.js/mcp</text></g>`);
    parts.push(`<text x="${W / 2}" y="400" text-anchor="middle" font-family="${SANS}" font-size="22" fill="${C.muted}" opacity="${ease(s, 1.0, 1.4)}">Claude · ChatGPT · Cursor · Codex</text>`);
    parts.push(caption('An MCP server for every repo. Free, no signup.'));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('\n')}</svg>`;
}

const render = (svg: string) => new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' } }).render().asPng();

const work = mkdtempSync(join(tmpdir(), 'video-'));
try {
  const frames = Math.round(DURATION * FPS);
  for (let i = 0; i < frames; i++) writeFileSync(join(work, `f${String(i).padStart(4, '0')}.png`), render(frame(i / FPS)));
  const run = (args: string[]) => {
    const r = Bun.spawnSync(['ffmpeg', '-loglevel', 'error', '-y', ...args]);
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  };
  const input = ['-framerate', String(FPS), '-i', join(work, 'f%04d.png')];
  const mp4 = join(work, 'demo.mp4');
  run([...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-preset', 'slow', '-movflags', '+faststart', '-an', mp4]);
  const poster = join(work, 'demo.jpg');
  run(['-i', join(work, `f${String(Math.round(8.8 * FPS)).padStart(4, '0')}.png`), '-q:v', '4', poster]);
  const docs = join(here, '../../../docs');
  mkdirSync(docs, { recursive: true });
  run([...input, '-vf', 'fps=12,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48[p];[b][p]paletteuse=dither=none', join(docs, 'demo.gif')]);
  const b64 = (f: string) => readFileSync(f).toString('base64');
  writeFileSync(
    join(here, 'src', 'video.generated.ts'),
    `// Written by \`bun run video\` (scripts/video.ts). Do not edit.\nexport const VIDEO: Record<string, { type: string; base64: string }> = {\n  'demo.mp4': { type: 'video/mp4', base64: '${b64(mp4)}' },\n  'demo.jpg': { type: 'image/jpeg', base64: '${b64(poster)}' },\n};\n`,
  );
  console.log(`Wrote src/video.generated.ts (${Math.round(readFileSync(mp4).length / 1024)} KB video) and docs/demo.gif`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
