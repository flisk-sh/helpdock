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

	it("carries the baseline security headers on redirects, 503s and probes", async () => {
		for (const [path, method] of [["/", "GET"], ["/mcp", "POST"], ["/ready", "GET"]]) {
			const res = await call(path, method);
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
			expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
			expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
			expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
			expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
		}
		expect((await call("/")).headers.get("location")).toBe(TARGET);
	});
});
