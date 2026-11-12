import { describe, expect, it } from "vitest";
import {
	AnswerCache,
	aiConfig,
	answerMessages,
	callWorkersAi,
	checkCommands,
	claims,
	DailyCap,
	DEFAULT_MODEL,
	finishAnswer,
	pickPassages,
	redactSecrets,
	removeFiller,
	supported,
} from "../src/ai-answer";

describe("aiConfig", () => {
	it("is off without both the account and the token", () => {
		expect(aiConfig({})).toBeNull();
		expect(aiConfig({ HELPDOCK_AI_ACCOUNT: "acc" })).toBeNull();
		expect(aiConfig({ HELPDOCK_AI_TOKEN: "tok" })).toBeNull();
	});

	it("defaults to the Flisk repository, the 32B model and small caps", () => {
		expect(
			aiConfig({ HELPDOCK_AI_ACCOUNT: "acc", HELPDOCK_AI_TOKEN: "tok" }),
		).toEqual({
			account: "acc",
			token: "tok",
			model: DEFAULT_MODEL,
			repos: ["flisk-sh/flisk"],
			perDay: 15,
			perVisitorPerHour: 10,
		});
	});

	it("reads the repositories and caps, ignoring nonsense numbers", () => {
		const c = aiConfig({
			HELPDOCK_AI_ACCOUNT: "a",
			HELPDOCK_AI_TOKEN: "t",
			HELPDOCK_AI_REPOS: " Flisk-SH/Flisk , foo/bar",
			HELPDOCK_AI_PER_DAY: "200",
			HELPDOCK_AI_PER_HOUR: "x",
		});
		expect(c?.repos).toEqual(["flisk-sh/flisk", "foo/bar"]);
		expect(c?.perDay).toBe(200);
		expect(c?.perVisitorPerHour).toBe(10);
	});
});

describe("pickPassages", () => {
	it("keeps at most two sections of a page and six in all, in order", () => {
		const hits = ["a", "a", "a", "b", "c", "d", "e", "f", "g"].map(
			(source, i) => ({ source, section: `s${i}`, i }),
		);
		expect(pickPassages(hits).map((h) => `${h.source}${h.i}`)).toEqual([
			"a0",
			"a1",
			"b3",
			"c4",
			"d5",
			"e6",
		]);
	});

	it("keeps a page's intro as one of its two sections", () => {
		const hits = [
			{ source: "docs/ci.md", section: "Installing flisk and Tilt" },
			{ source: "docs/ci.md", section: "Action versions and permissions" },
			{ source: "docs/ci.md", section: "" },
			{ source: "docs/wsl2.md", section: "CI evidence" },
		];
		expect(pickPassages(hits).map((h) => `${h.source}#${h.section}`)).toEqual([
			"docs/ci.md#Installing flisk and Tilt",
			"docs/ci.md#",
			"docs/wsl2.md#CI evidence",
		]);
	});
});

describe("answerMessages", () => {
	it("numbers the passages and cuts long ones", () => {
		const [system, user] = answerMessages("How do I use Flisk in CI?", [
			{
				source: "docs/ci.md",
				section: "",
				title: "Running Flisk in CI",
				body: "x".repeat(2000),
			},
			{
				source: "docs/ci.md",
				section: "The workflow",
				title: "Running Flisk in CI",
				body: "jobs:",
			},
		]);
		expect(system.role).toBe("system");
		expect(user.content).toContain("Question: How do I use Flisk in CI?");
		expect(user.content).toContain("[1] Running Flisk in CI (docs/ci.md)");
		expect(user.content).toContain("[2] The workflow (docs/ci.md)");
		expect(user.content).not.toContain("x".repeat(1501));
	});
});

describe("redactSecrets", () => {
	it("replaces keys, tokens and passwords in URLs", () => {
		const q = redactSecrets(
			"my key sk-proj-abcdefghijklmnop1234 and ghp_abcdefghijklmnopqrstuvwxyz12 and AKIAABCDEFGHIJKLMNOP fail at postgres://app:hunter2@db:5432/x",
		);
		expect(q).not.toMatch(/sk-proj|ghp_|AKIA|hunter2/);
		expect(q).toContain("postgres://[redacted]@db:5432/x");
	});

	it("leaves an ordinary question alone", () => {
		const q =
			"flisk up hangs and the service never becomes healthy, what should I check?";
		expect(redactSecrets(q)).toBe(q);
	});
});

describe("checkCommands", () => {
	const passages = [
		"Run `flisk project --yes` in the repository. `flisk import . --yes` reads docker-compose.yml.",
		"flisk down Cheat Sheet\n| `--purge` | Also deletes the project volumes |",
		"Stuck? Other languages: add `--language python`, `go`, `rust`, or `node`.",
		"```bash\nnpm install -g @flisk-sh/flisk\n```",
	];

	it("finds what a line claims", () => {
		expect(claims("Run `flisk project --yes` [1].", false)).toEqual([
			"flisk project --yes",
		]);
		expect(claims("Use `.env` for secrets.", false)).toEqual([]);
		expect(claims("Add --purge to remove volumes.", false)).toEqual([
			"--purge",
		]);
		expect(claims("$ flisk up", true)).toEqual(["flisk up"]);
		// The 70B answer from the eval: one made-up command written as two code spans.
		expect(
			claims(
				"you can use the `flisk import` command with the `--language python` flag [3].",
				false,
			),
		).toEqual(["flisk import --language python"]);
	});

	it("needs every word of a command in one passage", () => {
		const p = [
			"flisk down cheat sheet | `--purge` | deletes volumes",
			"flisk import [dir] reads compose",
		];
		expect(supported("flisk down --purge", p)).toBe(true);
		expect(supported("flisk import --purge", p)).toBe(false);
		expect(supported("flisk down --pur", p)).toBe(false);
		expect(supported("flisk eject", p)).toBe(false);
	});

	it("drops the command the model made up in the eval and keeps the real ones", () => {
		const answer = [
			"To add Flisk, run `flisk project --yes` [3].",
			"For a Python worker, use `flisk import --language python` [3].",
			"To remove volumes, use `flisk down --purge` [4].",
			"Use --purge to delete volumes.",
		].join("\n");
		const { text, dropped } = checkCommands(answer, passages);
		expect(text).toContain("flisk project --yes");
		// `flisk import` is in one passage and `--language python` in another: made up, so dropped.
		expect(text).not.toContain("--language python");
		// The flags table under the "flisk down" heading backs `flisk down --purge`.
		expect(text).toContain("flisk down --purge");
		expect(text).toContain("Use --purge to delete volumes.");
		expect(dropped).toBe(1);
	});

	it("keeps or drops a fenced block as a whole", () => {
		const ok = checkCommands(
			"Install it:\n```bash\nnpm install -g @flisk-sh/flisk\n```",
			passages,
		);
		expect(ok.text).toContain("npm install -g @flisk-sh/flisk");
		const bad = checkCommands(
			"Install it:\n```bash\nnpm install -g @flisk-sh/flisk\nflisk setup --all\n```",
			passages,
		);
		expect(bad.text).toBe("Install it:");
		expect(bad.dropped).toBe(1);
	});

	it("ignores case and spacing", () => {
		expect(checkCommands("Run `FLISK  project --yes`.", passages).dropped).toBe(
			0,
		);
	});
});

describe("removeFiller", () => {
	it("removes the closing sentences the models added in the eval", () => {
		expect(
			removeFiller(
				"To install Flisk, use npm [1]. \nThey do not cover uninstalling Flisk.",
			),
		).toBe("To install Flisk, use npm [1].");
		expect(
			removeFiller(
				"Use `flisk down --purge` [1]. The docs do not cover non-Flisk methods to remove volumes.",
			),
		).toBe("Use `flisk down --purge` [1].");
		expect(
			removeFiller(
				"- Set FLISK_HTTP_PORT.\n\nThese instructions do not cover setting up Docker.",
			),
		).toBe("- Set FLISK_HTTP_PORT.");
	});

	it("keeps a sentence that only mentions coverage in passing", () => {
		expect(removeFiller("The test covers 20 questions.")).toBe(
			"The test covers 20 questions.",
		);
	});
});

describe("finishAnswer", () => {
	it('turns "not covered" into the handoff', () => {
		expect(finishAnswer("The docs do not cover this.", [])).toEqual({
			text: null,
			notCovered: true,
			dropped: 0,
		});
		expect(finishAnswer("  ", []).notCovered).toBe(true);
	});

	it("shows nothing when every line was dropped", () => {
		const r = finishAnswer("Run `flisk magic --now` [1].", ["nothing here"]);
		expect(r).toEqual({ text: null, notCovered: false, dropped: 1 });
	});

	it("cleans and checks a normal answer", () => {
		const r = finishAnswer(
			"No, Flisk runs on Docker or local processes [1].\nThey do not cover Helm.",
			["Flisk runs on Docker"],
		);
		expect(r).toEqual({
			text: "No, Flisk runs on Docker or local processes [1].",
			notCovered: false,
			dropped: 0,
		});
	});
});

describe("DailyCap", () => {
	it("allows the limit per UTC day and starts again the next day", () => {
		let t = Date.parse("2026-11-10T23:59:00Z");
		const cap = new DailyCap(2, () => t);
		expect([cap.take(), cap.take(), cap.take()]).toEqual([true, true, false]);
		expect(cap.remaining()).toBe(0);
		t = Date.parse("2026-11-11T00:00:01Z");
		expect(cap.take()).toBe(true);
		expect(cap.remaining()).toBe(1);
	});
});

describe("AnswerCache", () => {
	it("matches the same question however it is typed, until it expires", () => {
		let t = 0;
		const cache = new AnswerCache<string>(1000, 2, () => t);
		cache.set(
			AnswerCache.key("/flisk-sh/flisk/", "How do I use Flisk in CI?"),
			"a",
		);
		expect(
			cache.get(
				AnswerCache.key("/flisk-sh/flisk/", "  how do i use  flisk in ci"),
			),
		).toBe("a");
		expect(
			cache.get(AnswerCache.key("/other/repo/", "How do I use Flisk in CI?")),
		).toBeUndefined();
		t = 1001;
		expect(
			cache.get(
				AnswerCache.key("/flisk-sh/flisk/", "How do I use Flisk in CI?"),
			),
		).toBeUndefined();
	});

	it("forgets the oldest answer when full", () => {
		const cache = new AnswerCache<number>(1000, 2, () => 0);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);
		expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual([
			undefined,
			2,
			3,
		]);
	});
});

describe("callWorkersAi", () => {
	const config = {
		account: "acc",
		token: "tok",
		model: DEFAULT_MODEL,
		repos: [],
		perDay: 1,
		perVisitorPerHour: 1,
	};

	it("posts the messages with the token and returns the text", async () => {
		let seen: { url: string; init: RequestInit } | null = null;
		const fake = (async (url: string, init: RequestInit) => {
			seen = { url, init };
			return new Response(
				JSON.stringify({ success: true, result: { response: "Hi [1]." } }),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;
		await expect(
			callWorkersAi(config, [{ role: "user", content: "q" }], fake),
		).resolves.toBe("Hi [1].");
		const got = seen as unknown as { url: string; init: RequestInit };
		expect(got.url).toBe(
			`https://api.cloudflare.com/client/v4/accounts/acc/ai/run/${DEFAULT_MODEL}`,
		);
		expect((got.init.headers as Record<string, string>).authorization).toBe(
			"Bearer tok",
		);
		expect(JSON.parse(String(got.init.body)).temperature).toBe(0);
	});

	it("throws on an error answer", async () => {
		const fake = (async () =>
			new Response(
				JSON.stringify({ success: false, errors: [{ code: 10000 }] }),
				{ status: 401 },
			)) as unknown as typeof fetch;
		await expect(callWorkersAi(config, [], fake)).rejects.toThrow("http 401");
	});
});
