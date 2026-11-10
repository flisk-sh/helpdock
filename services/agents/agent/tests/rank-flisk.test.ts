// The ranking test: 20 questions about Flisk, graded by hand on 2026-11-10, and the page that answers each one. A
// question passes when that page is among the six passages an AI answer would read (src/ai-answer.ts, pickPassages).
// The docs are a committed snapshot of flisk-sh/flisk at one commit, so the test is offline and only Helpdock's own
// changes move it. Refresh the snapshot with scripts/snapshot-docs.ts, and check the answers still hold when you do.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { pickPassages } from "../src/ai-answer";
import type { SearchHit } from "../src/docs";
import { docPriority, normalizeMarkdown } from "../src/github";
import { createSqliteStores } from "../src/store-sqlite";

const snapshot = JSON.parse(
	gunzipSync(
		readFileSync(join(import.meta.dirname, "fixtures", "flisk-docs.json.gz")),
	).toString("utf8"),
) as {
	commit: string;
	files: Record<string, string>;
};

const { docs } = createSqliteStores(":memory:");
const passages = async (q: string): Promise<SearchHit[]> =>
	pickPassages(await docs.search(q, 24));

beforeAll(async () => {
	// In the order a help center indexes them (repos.ts, startIndex).
	const pages = Object.entries(snapshot.files)
		.sort(([a], [b]) => docPriority(b) - docPriority(a) || a.localeCompare(b))
		.map(([source, text]) => ({
			source,
			markdown: normalizeMarkdown(source, text),
		}));
	await docs.upsertMany(pages);
});

// [id, question, what answers it (any one will do), must it be the first passage]. An entry is a page (docs/ci.md), or
// a page and section (docs/ci.md#The workflow; docs/ci.md# is the page's intro) when only that section answers.
const CASES: Array<[string, string, string[], boolean]> = [
	["c1", "Do we need Kubernetes to run Flisk?", ["docs/faq-teams.md"], true],
	[
		"c2",
		"How do I add Flisk to an existing repo?",
		[
			"docs/adopt-flisk.md#2. Pilot in one afternoon",
			"docs/operator-runbook.md#Importing an existing repo",
			"docs/gradual-adoption.md#What flisk project --yes did to that repository",
		],
		false,
	],
	["c3", "Which files does Flisk generate?", ["docs/generated-files.md"], true],
	[
		"c4",
		"How do I use Flisk in CI?",
		["docs/ci.md#", "docs/ci.md#The workflow"],
		false,
	],
	["c5", "What happens if we leave Flisk?", ["docs/leaving-flisk.md"], true],
	["c6", "How do AI agents use Flisk?", ["docs/faq-teams.md"], true],
	[
		"c7",
		"How do I run database migrations?",
		["docs/faq-teams.md", "docs/service-json.md"],
		true,
	],
	["c8", "Port is already in use", ["docs/troubleshooting.md"], true],
	[
		"r1",
		"Can I run Flisk without Docker?",
		["docs/run-without-docker.md#"],
		true,
	],
	[
		"r2",
		"How do I install Flisk?",
		["docs/install/npm.md", "docs/install/binary.md"],
		false,
	],
	[
		"r3",
		"How do I stop the stack and remove its volumes?",
		["docs/how-flisk-up-works.md", "docs/cheat-sheet.md"],
		false,
	],
	[
		"r4",
		"What does flisk doctor check?",
		["docs/reference/doctor-contract.md", "docs/operator-runbook.md"],
		false,
	],
	[
		"r5",
		"I have a docker-compose.yml with postgres and a node api, how do I move it to Flisk and keep my data?",
		["docs/data.md"],
		false,
	],
	[
		"r7",
		"What is the difference between flisk doctor and flisk config verify?",
		["docs/commands-compared.md"],
		true,
	],
	[
		"r8",
		"flisk up hangs and the service never becomes healthy, what should I check?",
		["docs/troubleshooting.md"],
		false,
	],
	[
		"r9",
		"My frontend can't reach the backend URL locally",
		["docs/troubleshooting.md"],
		true,
	],
	[
		"r10",
		"Where do environment variables and secrets go?",
		["docs/environment.md", "docs/security.md"],
		false,
	],
	[
		"o1",
		"Does Flisk deploy my app to AWS ECS?",
		["docs/commands-compared.md"],
		false,
	],
	["o2", "How much does Flisk Pro cost per seat?", ["docs/faq-teams.md"], true],
];

describe(`ranking on the Flisk docs at ${snapshot.commit.slice(0, 7)}`, () => {
	for (const [id, question, pages, first] of CASES) {
		it(`${id}: ${question}`, async () => {
			const hits = await passages(question);
			const matches = (h: SearchHit) =>
				pages.some((p) =>
					p.includes("#") ? p === `${h.source}#${h.section}` : p === h.source,
				);
			const shown = hits.map((h) => `${h.source}#${h.section}`).join(", ");
			expect(hits.some(matches), `top passages: ${shown}`).toBe(true);
			if (first)
				expect(
					matches(hits[0]),
					`first passage: ${hits[0] ? `${hits[0].source}#${hits[0].section}` : "none"}`,
				).toBe(true);
		});
	}

	it("r9 finds the troubleshooting entry written for it", async () => {
		const [top] = await passages(
			"My frontend can't reach the backend URL locally",
		);
		expect(top.section).toBe("The frontend cannot reach the backend URL");
	});

	// Known miss: a long question that mixes several topics. When this starts passing, move it into CASES.
	it.fails("r6: How do I add a Python worker that reads from a queue next to my existing Node API? (known miss)", async () => {
		const found = (
			await passages(
				"How do I add a Python worker that reads from a queue next to my existing Node API?",
			)
		).map((h) => h.source);
		expect(found).toContain("docs/101/11-more-kinds-of-service.md");
	});
});
