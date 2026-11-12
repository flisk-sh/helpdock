import { describe, expect, it } from "bun:test";
import worker, { BACK_ON, TARGET } from "./worker.js";

const call = (path: string, method = "GET") =>
	worker.fetch(new Request(`https://helpdock.flisk.si${path}`, { method }));

describe("paused Helpdock", () => {
	it("sends every page to flisk.sh with a temporary redirect", async () => {
		for (const path of ["/", "/flisk-sh/flisk/tree/main/docs/", "/docs"]) {
			const res = await call(path);
			expect(res.status).toBe(302);
			expect(res.headers.get("location")).toBe(TARGET);
			expect(res.headers.get("cache-control")).toBe("no-store");
		}
		expect(TARGET).toBe("https://flisk.sh/");
	});

	it("answers /mcp and /answer with a JSON 503 instead of a redirect", async () => {
		for (const path of ["/mcp", "/answer"]) {
			const res = await call(path, "POST");
			expect(res.status).toBe(503);
			expect(res.headers.get("retry-after")).toContain("01 Dec 2026");
			expect(res.headers.get("content-type")).toContain("application/json");
			expect((await res.json()).error).toBe(`Helpdock is paused until ${BACK_ON}.`);
		}
	});

	it("reports not ready for health checks", async () => {
		expect((await call("/ready")).status).toBe(503);
	});
});
