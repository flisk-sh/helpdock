import { describe, expect, it } from "bun:test";
import worker, { BACK_ON } from "./worker.js";

const call = (path: string, method = "GET") =>
	worker.fetch(new Request(`https://helpdock.flisk.si${path}`, { method }));

describe("paused page", () => {
	it("says Helpdock is paused and when it is back, with a 503 and Retry-After", async () => {
		const res = await call("/flisk-sh/flisk/tree/main/docs/");
		expect(res.status).toBe(503);
		expect(res.headers.get("retry-after")).toContain("01 Dec 2026");
		const html = await res.text();
		expect(html).toContain(`Helpdock is paused until ${BACK_ON}.`);
		expect(html).toContain("https://flisk.sh/docs/");
	});

	it("answers /mcp and /answer with a JSON 503 instead of a web page", async () => {
		for (const path of ["/mcp", "/answer"]) {
			const res = await call(path, "POST");
			expect(res.status).toBe(503);
			expect(res.headers.get("content-type")).toContain("application/json");
			expect((await res.json()).error).toContain("paused");
		}
	});

	it("keeps HEAD requests bodiless", async () => {
		const res = await call("/", "HEAD");
		expect(res.status).toBe(503);
		expect(await res.text()).toBe("");
	});
});
