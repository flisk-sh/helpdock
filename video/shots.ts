// Takes the screenshots the film shows: each entry of "shots" in film.json is a page of the live site, captured at
// the browser window's width (1580 px) and as tall as the page, into video/shots/<name>.png.
//   bun video/shots.ts            all of them
//   bun video/shots.ts answer     one
// "rects" names CSS selectors whose boxes are saved to shots/<name>.json. An entry can run "steps" first:
// JavaScript evaluated in the page, each awaited, with "wait" seconds after.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./cdp";

const dir = import.meta.dir;
const config = JSON.parse(readFileSync(join(dir, "film.json"), "utf8"));
const only = process.argv.slice(2);
mkdirSync(join(dir, "shots"), { recursive: true });

const b = await launch(9342);
try {
	for (const shot of config.shots) {
		if (only.length && !only.includes(shot.name)) continue;
		await b.viewport(1580, 812, 1);
		await b.goto(shot.url, (shot.settle ?? 2) * 1000);
		for (const step of shot.steps ?? []) {
			await b.evaluate(`(async () => { ${step.js} })()`);
			await Bun.sleep((step.wait ?? 1) * 1000);
		}
		const height = Math.min(
			shot.maxHeight ?? 4000,
			await b.evaluate("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)"),
		);
		await b.viewport(1580, Math.max(812, height), 1);
		await Bun.sleep(500);
		await Bun.write(join(dir, "shots", `${shot.name}.png`), await b.png());
		// Where named elements sit on the screenshot, for highlights and the cursor: "@<shot>.<name>" in film.json.
		const rects = await b.evaluate(
			`JSON.stringify(Object.fromEntries(Object.entries(${JSON.stringify(shot.rects ?? {})}).map(([k, sel]) => { const e = document.querySelector(sel); if (!e) return [k, null]; const r = e.getBoundingClientRect(); return [k, [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)]]; })))`,
		);
		await Bun.write(join(dir, "shots", `${shot.name}.json`), rects);
		console.log(`${shot.name}: ${shot.url} (${height}px)`);
	}
} finally {
	b.close();
}
