// A written answer from the passages search found, by a model on Cloudflare Workers AI. Off unless both
// HELPDOCK_AI_ACCOUNT and HELPDOCK_AI_TOKEN are set: without them Helpdock calls no model, as before.
//
// The answer is held to the passages: the prompt allows only what they say, a line that quotes a command or flag the
// passages do not contain is dropped, and an answer with nothing left is not shown (the visitor keeps the passages).
// Questions are not stored. Everything here except callWorkersAi is pure, so tests/ai-answer.test.ts covers it.
import type { SearchHit } from "./docs";

export const DEFAULT_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";
const PASSAGES = 6;
const PASSAGE_CHARS = 1500;

export interface AiConfig {
	account: string;
	token: string;
	model: string;
	/** owner/repo help centers that may use the model, lower case. The root docs never do. */
	repos: string[];
	perDay: number;
	perVisitorPerHour: number;
}

/** The settings from the environment, or null when the model is off. */
export function aiConfig(
	env: Record<string, string | undefined>,
): AiConfig | null {
	const account = env.HELPDOCK_AI_ACCOUNT?.trim();
	const token = env.HELPDOCK_AI_TOKEN?.trim();
	if (!account || !token) return null;
	const list = (env.HELPDOCK_AI_REPOS ?? "flisk-sh/flisk")
		.split(",")
		.map((r) => r.trim().toLowerCase())
		.filter(Boolean);
	const num = (v: string | undefined, d: number) =>
		Number(v) > 0 ? Math.floor(Number(v)) : d;
	return {
		account,
		token,
		model: env.HELPDOCK_AI_MODEL?.trim() || DEFAULT_MODEL,
		repos: list,
		perDay: num(env.HELPDOCK_AI_PER_DAY, 50),
		perVisitorPerHour: num(env.HELPDOCK_AI_PER_HOUR, 10),
	};
}

/**
 * The passages the model reads: at most two sections of one page, six in all, in search order. When a page's intro (the
 * text before its first subheading, section '') matched, it is one of that page's two: it says what the whole page is
 * for, while sections that outrank it by a little are often a detail (ci.md's install table for "how do I use it in CI").
 */
export function pickPassages<T extends Pick<SearchHit, "source" | "section">>(
	hits: T[],
): T[] {
	const byPage = new Map<string, T[]>();
	for (const h of hits)
		byPage.set(h.source, [...(byPage.get(h.source) ?? []), h]);
	const keep = new Set<T>();
	for (const list of byPage.values()) {
		keep.add(list[0]);
		const intro = list.find((h, i) => i > 0 && h.section === "");
		const second = intro ?? list[1];
		if (second) keep.add(second);
	}
	return hits.filter((h) => keep.has(h)).slice(0, PASSAGES);
}

export const SYSTEM_PROMPT =
	"You answer questions about a software project using only the numbered doc passages you are given. Cite passages as [n]. " +
	"Give whatever part of the answer the passages contain, as short steps or sentences. " +
	"Only if no passage is relevant at all, reply exactly: The docs do not cover this. " +
	"Never invent commands, flags or file names that are not in the passages. Under 120 words.";

export const NOT_COVERED = "The docs do not cover this.";

export function answerMessages(
	question: string,
	passages: Array<Pick<SearchHit, "source" | "section" | "title" | "body">>,
) {
	const lines = [`Question: ${question}`, ""];
	passages.forEach((p, i) => {
		lines.push(
			`[${i + 1}] ${p.section || p.title} (${p.source})`,
			String(p.body ?? "").slice(0, PASSAGE_CHARS),
			"",
		);
	});
	return [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: lines.join("\n").trim() },
	];
}

// Text that looks like a credential: provider key prefixes, JWTs, private keys, URLs with a password, and long
// unbroken runs of key-like characters. It is replaced before the question leaves for the model.
const SECRET_PATTERNS: RegExp[] = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
	/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g,
	/\bsk-[A-Za-z0-9_-]{16,}/g,
	/\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}/g,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bAIza[0-9A-Za-z_-]{30,}/g,
	/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
	/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi,
	/\b[A-Za-z0-9+/_-]{40,}={0,2}/g,
];

/** The question with anything that looks like a secret replaced by [redacted]. */
export function redactSecrets(text: string): string {
	let out = text;
	for (const re of SECRET_PATTERNS)
		out = out.replace(re, (m, scheme) =>
			typeof scheme === "string" && m.includes("@") && scheme.includes("://")
				? `${scheme}[redacted]@`
				: "[redacted]",
		);
	return out;
}

const COMMAND_START =
	/^(flisk|npx|bunx|bun|npm|pnpm|yarn|docker|tilt|curl|git|brew|scoop|irm|uv|pip|python3?|node|kubectl|helm)\b/;

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * What a line claims as a command or flag: inline code that starts like a command or carries a flag, a fenced line,
 * and bare flags (--purge) in the prose.
 */
export function claims(line: string, fenced: boolean): string[] {
	const out: string[] = [];
	if (fenced) {
		const cmd = line.replace(/^\s*\$\s*/, "").trim();
		if (cmd && !cmd.startsWith("#")) out.push(cmd);
		return out;
	}
	const commands: string[] = [];
	const flags: string[] = [];
	for (const m of line.matchAll(/`([^`]+)`/g)) {
		const code = m[1].trim();
		if (COMMAND_START.test(code)) commands.push(code);
		else if (/^--?[a-z]/i.test(code)) flags.push(code);
		else if (/(^|\s)--?[a-z][\w-]*/i.test(code)) out.push(code);
	}
	const prose = line.replace(/`[^`]*`/g, " ");
	for (const m of prose.matchAll(/(?:^|\s)(--[a-z][\w-]*)/gi)) flags.push(m[1]);
	// "use the `flisk import` command with the `--language python` flag" claims one command, not two things: a flag in a
	// line that names a command belongs to it. With several commands, to the last one (the flag usually follows it).
	if (commands.length > 0 && flags.length > 0)
		commands[commands.length - 1] += ` ${flags.join(" ")}`;
	else out.push(...flags);
	out.push(...commands);
	return out;
}

/**
 * Whether the passages back a claim, ignoring case and spacing: the claim appears whole in one passage, or one passage
 * holds its command (`flisk down`) and each of its other words (`--purge`), as a flags table under a "flisk down"
 * heading does. Words spread over different passages do not count: `flisk import --language python` is made up even
 * though one passage shows `flisk import` and another `--language python`.
 */
export function supported(claim: string, passages: string[]): boolean {
	const c = squash(claim);
	if (passages.some((p) => p.includes(c))) return true;
	const words = c.split(" ").filter(Boolean);
	const base: string[] = [];
	for (const w of words) {
		if (w.startsWith("-") || base.length === 2) break;
		base.push(w);
	}
	const rest = words.slice(base.length);
	const has = (p: string, w: string) =>
		new RegExp(
			`(^|[^\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w-])`,
		).test(p);
	return passages.some(
		(p) =>
			(base.length === 0 || p.includes(base.join(" "))) &&
			rest.every((w) => has(p, w)),
	);
}

/**
 * The answer with every line dropped that claims a command or flag the passages do not contain, and the count dropped.
 * Each passage is its heading and text. See `supported` for when a claim counts as found.
 */
export function checkCommands(
	answer: string,
	passages: string[],
): { text: string; dropped: number } {
	const texts = passages.map(squash);
	const kept: string[] = [];
	let dropped = 0;
	let fenced = false;
	let fenceBuf: string[] = [];
	let fenceOk = true;
	for (const line of answer.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			if (!fenced) {
				fenced = true;
				fenceBuf = [line];
				fenceOk = true;
			} else {
				fenceBuf.push(line);
				if (fenceOk) kept.push(...fenceBuf);
				else dropped++;
				fenced = false;
			}
			continue;
		}
		const bad = claims(line, fenced).some((c) => !supported(c, texts));
		if (fenced) {
			fenceBuf.push(line);
			if (bad) fenceOk = false;
			continue;
		}
		if (bad) dropped++;
		else kept.push(line);
	}
	if (fenced && fenceOk) kept.push(...fenceBuf);
	else if (fenced) dropped++;
	return {
		text: kept
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
		dropped,
	};
}

// The closing sentence models add on their own ("They do not cover how to uninstall Flisk."): true of nearly every
// answer and no help, so it is removed. The prompt asks for "The docs do not cover this." only when nothing is relevant.
const FILLER =
	/(^|(?<=[.!?:])\s+|\n)\s*(the (docs|passages|documentation|other passages)|these (docs|passages|instructions|steps)|they|it) (do|does) not (cover|provide|include|mention|describe|explain)[^.\n]*\.?/gi;

export function removeFiller(answer: string): string {
	return answer
		.replace(FILLER, (m, lead) => (lead === "\n" ? "\n" : ""))
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export interface Finished {
	/** The answer to show, or null when nothing is left to show. */
	text: string | null;
	/** The model said the docs do not cover the question: offer the handoff. */
	notCovered: boolean;
	dropped: number;
}

/** The model's reply, checked against the passages and cleaned, ready to show (or not). */
export function finishAnswer(reply: string, passages: string[]): Finished {
	const raw = reply.trim();
	if (!raw || squash(raw).startsWith(squash(NOT_COVERED).replace(/\.$/, "")))
		return { text: null, notCovered: true, dropped: 0 };
	const { text, dropped } = checkCommands(removeFiller(raw), passages);
	// Nothing but citations or punctuation left.
	return {
		text: /[\p{L}\p{N}]{3,}/u.test(text.replace(/\[\d+(,\s*\d+)*\]/g, ""))
			? text
			: null,
		notCovered: false,
		dropped,
	};
}

/** Model calls per UTC day, shared by every visitor. */
export class DailyCap {
	private day = "";
	private used = 0;

	constructor(
		private readonly limit: number,
		private readonly now: () => number = Date.now,
	) {}

	private roll() {
		const d = new Date(this.now()).toISOString().slice(0, 10);
		if (d !== this.day) {
			this.day = d;
			this.used = 0;
		}
	}

	/** Takes one call from today's allowance; false when it is used up. */
	take(): boolean {
		this.roll();
		if (this.used >= this.limit) return false;
		this.used++;
		return true;
	}

	remaining(): number {
		this.roll();
		return Math.max(0, this.limit - this.used);
	}
}

/** Answers kept by question, so a starter question asked a hundred times costs one call. Kept for six hours. */
export class AnswerCache<T> {
	private items = new Map<string, { at: number; value: T }>();

	constructor(
		private readonly ttlMs = 6 * 60 * 60 * 1000,
		private readonly max = 500,
		private readonly now: () => number = Date.now,
	) {}

	static key(scope: string, question: string): string {
		return `${scope}\u0000${squash(question).replace(/[?!.]+$/, "")}`;
	}

	get(key: string): T | undefined {
		const hit = this.items.get(key);
		if (!hit) return undefined;
		if (this.now() - hit.at > this.ttlMs) {
			this.items.delete(key);
			return undefined;
		}
		return hit.value;
	}

	set(key: string, value: T) {
		if (this.items.size >= this.max)
			this.items.delete(this.items.keys().next().value as string);
		this.items.set(key, { at: this.now(), value });
	}
}

/** One call to Workers AI's REST API; the model's text, or an error. */
export async function callWorkersAi(
	config: AiConfig,
	messages: Array<{ role: string; content: string }>,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 20_000,
): Promise<string> {
	const res = await fetchFn(
		`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.account)}/ai/run/${config.model}`,
		{
			method: "POST",
			headers: {
				authorization: `Bearer ${config.token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ messages, max_tokens: 350, temperature: 0 }),
			signal: AbortSignal.timeout(timeoutMs),
		},
	);
	const json = (await res.json().catch(() => null)) as {
		success?: boolean;
		result?: { response?: string };
	} | null;
	if (!res.ok || !json?.success || typeof json.result?.response !== "string")
		throw new Error(`workers ai: http ${res.status}`);
	return json.result.response;
}
