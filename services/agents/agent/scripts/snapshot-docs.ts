// Writes tests/fixtures/flisk-docs.json.gz: the Flisk docs pages Helpdock indexes, at one commit, for the ranking test
// (tests/rank-flisk.test.ts), so CI stays offline. The same files as a help center would read: Markdown-like paths,
// no translations, and the repository's own docs/.helpdock.json applied.
//
//   bun scripts/snapshot-docs.ts <checkout of flisk-sh/flisk> <commit>
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import { applyConfig, parseConfig } from "../src/config";
import { isDocPath, isTranslatedFile } from "../src/github";

const [checkout, commit] = process.argv.slice(2);
if (!checkout || !/^[0-9a-f]{40}$/.test(commit ?? "")) {
	console.error(
		"usage: bun scripts/snapshot-docs.ts <checkout of flisk-sh/flisk> <40-character commit>",
	);
	process.exit(1);
}
const git = (...args: string[]) =>
	execFileSync("git", ["-C", checkout, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
const paths = git("ls-tree", "-r", "--name-only", commit, "docs/")
	.split("\n")
	.filter((p) => p && isDocPath(p) && !isTranslatedFile(basename(p)));
const files = paths.map((path) => ({
	path,
	text: git("show", `${commit}:${path}`),
}));
const config = parseConfig(git("show", `${commit}:docs/.helpdock.json`));
const kept = applyConfig(files, config, "docs").paths;
const out = {
	repo: "flisk-sh/flisk",
	commit,
	scope: "docs",
	files: Object.fromEntries(kept.map((f) => [f.path, f.text])),
};
const target = join(
	import.meta.dirname,
	"..",
	"tests",
	"fixtures",
	"flisk-docs.json.gz",
);
writeFileSync(target, gzipSync(JSON.stringify(out), { level: 9 }));
console.log(`${kept.length} pages from ${commit.slice(0, 7)} -> ${target}`);
