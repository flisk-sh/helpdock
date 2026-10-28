// Renders the product film from film.json: frames of film.html through headless Chrome, then
//   - an MP4 and a poster, embedded into the app as a generated module (served at /demo.mp4 and /demo.jpg),
//   - docs/demo.gif for the README.
//   bun video/render.ts                 the whole film
//   bun video/render.ts stills 2 7.5    video/out/still-<t>.png at those times, to check a scene
// Needs ffmpeg and Chrome (CHROME=/path/to/chrome to choose one). Take the screenshots first: bun video/shots.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./cdp";

const dir = import.meta.dir;
const root = join(dir, "..");
const config = JSON.parse(readFileSync(join(dir, "film.json"), "utf8"));
mkdirSync(join(dir, "out"), { recursive: true });

// "@shot.name" → that element's box [x, y, w, h] from shots/<shot>.json; "@shot.name:c" → its centre [x, y];
// "@shot.name:y" → its top, less 120 px, for scrolling to it; "@shot.name:w1.6" → a camera keyframe on it, and
// "@shot.name:s1.6" the same after scrolling to it.
// Image paths are made absolute.
const boxes = (shot: string) => JSON.parse(readFileSync(join(dir, "shots", `${shot}.json`), "utf8"));
const pad = (r: number[], p = 12) => [r[0] - p, r[1] - p, r[2] + 2 * p, r[3] + 2 * p];
function resolve(v: unknown): unknown {
	if (typeof v === "string" && v.startsWith("@")) {
		const [ref, part] = v.slice(1).split(":");
		const [shot, name] = ref.split(".");
		const r = boxes(shot)[name];
		if (!r) throw new Error(`no box for ${v}`);
		if (part === "c") return [r[0] + r[2] / 2, r[1] + r[3] / 2];
		// "@shot.name:w1.6": a camera keyframe centred on it at that zoom (the page starts at world 170, 178).
		if (part?.startsWith("w")) return [170 + r[0] + r[2] / 2, 178 + r[1] + r[3] / 2, Number(part.slice(1) || 1.5)];
		// "@shot.name:s1.4": the same, once the page has scrolled to it with ":y".
		if (part?.startsWith("s"))
			return [170 + r[0] + r[2] / 2, 178 + r[1] - Math.max(0, r[1] - 120) + r[3] / 2, Number(part.slice(1) || 1.4)];
		if (part === "y") return Math.max(0, r[1] - 120);
		return pad(r);
	}
	if (typeof v === "string" && /^shots\/.+\.png$/.test(v)) return `file://${join(dir, v)}`;
	if (Array.isArray(v)) return v.map(resolve);
	if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
	return v;
}
config.scenes = resolve(config.scenes);
config.icon = `file://${join(root, config.icon)}`;

// film.html with the scenes put in before its script runs.
const page = readFileSync(join(dir, "film.html"), "utf8").replace(
	"<script>",
	`<script>window.FILM_CONFIG = ${JSON.stringify(config)};</script>\n<script>`,
);
writeFileSync(join(dir, "film.run.html"), page);

const b = await launch(9341);
await b.viewport(1920, 1080, 1);
await b.goto(`file://${join(dir, "film.run.html")}`, 1500);
await b.evaluate(
	"document.fonts.ready.then(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))))",
);
const film = await b.evaluate("JSON.parse(JSON.stringify(window.FILM))");
const at = (t: number) => b.evaluate(`seek(${t})`);

const [mode, ...rest] = process.argv.slice(2);
try {
	if (mode === "stills") {
		for (const t of rest.map(Number)) {
			await at(t);
			await Bun.write(join(dir, "out", `still-${t}.png`), await b.png());
			console.log("still", t);
		}
	} else {
		const fps = Number(config.fps ?? 30);
		const n = Math.ceil(film.duration * fps);
		const master = join(dir, "out", "film.mp4");
		const ff = Bun.spawn(
			["ffmpeg", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
				"-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", master],
			{ stdin: "pipe" },
		);
		const t0 = Date.now();
		for (let i = 0; i < n; i++) {
			await at(i / fps);
			ff.stdin.write(await b.png("jpeg", 92));
			if (i % 120 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
		}
		ff.stdin.end();
		await ff.exited;

		const run = (args: string[]) => {
			const r = Bun.spawnSync(["ffmpeg", "-loglevel", "error", "-y", ...args]);
			if (r.exitCode !== 0) throw new Error(r.stderr.toString());
		};
		// For the page: 1280×720, small enough to embed, muted.
		const mp4 = join(dir, "out", "demo.mp4");
		run(["-i", master, "-vf", "scale=1280:-2:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "27",
			"-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
		const poster = join(dir, "out", "demo.jpg");
		run(["-ss", String(config.posterAt ?? 6), "-i", master, "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "4", poster]);
		// For the README: a GIF, which GitHub plays inline.
		mkdirSync(join(root, "docs"), { recursive: true });
		run(["-i", master, "-vf",
			"fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
			join(root, "docs", "demo.gif")]);

		const b64 = (f: string) => readFileSync(f).toString("base64");
		const files = { "demo.mp4": ["video/mp4", b64(mp4)], "demo.jpg": ["image/jpeg", b64(poster)] };
		const [q, ind] = config.style === "spaces" ? ["'", "  "] : ['"', "\t"];
		const body = Object.entries(files)
			.map(([name, [type, data]]) => `${ind}${q}${name}${q}: {\n${ind}${ind}type: ${q}${type}${q},\n${ind}${ind}base64:\n${ind}${ind}${ind}${q}${data}${q},\n${ind}},`)
			.join("\n");
		writeFileSync(
			join(root, config.module),
			`// Written by \`bun video/render.ts\` from video/film.json. Do not edit.\nexport const VIDEO: Record<string, { type: string; base64: string }> = {\n${body}\n};\n`,
		);
		const kb = (f: string) => Math.round(readFileSync(f).length / 1024);
		console.log(`${film.duration.toFixed(1)} s in ${((Date.now() - t0) / 1000).toFixed(0)} s: demo.mp4 ${kb(mp4)} KB, docs/demo.gif ${kb(join(root, "docs", "demo.gif"))} KB → ${config.module}`);
	}
} finally {
	b.close();
}
