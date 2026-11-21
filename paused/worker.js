// helpdock.flisk.si while Render's free hours are used up: show a short plain page (503 + Retry-After, so search
// engines keep the address) instead of Render's bare "This service has been suspended." /mcp and /answer get a JSON
// 503, so tools see a clear error rather than a web page. To bring Helpdock back, see paused/README.md.
export const BACK_ON = "1 December 2026";
export const TARGET = "https://flisk.sh/";
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Helpdock is resting until ${BACK_ON}</title>
<style>body{margin:0;font:18px/1.5 system-ui,sans-serif;background:#fff;color:#111}main{max-width:34rem;margin:0 auto;padding:12vh 20px}h1{font-size:1.9rem;line-height:1.2;margin:0 0 .6em}p{margin:0 0 1.2em}a.b{display:inline-block;background:#111;color:#fff;padding:.8em 1.2em;text-decoration:none;font-weight:600}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}a.b{background:#eee;color:#111}}</style></head>
<body><main><h1>Helpdock is resting until ${BACK_ON}</h1>
<p>Helpdock turns any GitHub repo's docs into a help center. It is paused for now, and it comes back on ${BACK_ON}.</p>
<p><a class="b" href="${TARGET}">See what Flisk does</a></p></main><script src="https://flisk.si/assets/bar.js" data-product="Helpdock" data-icon="helpdock" data-accent="#0d7a62" data-text="Turn any GitHub repo's docs into a help center." defer></script></body></html>`;
const RETRY_AFTER = "Tue, 01 Dec 2026 00:00:00 GMT";

const BASELINE = {
	"x-content-type-options": "nosniff",
	"x-frame-options": "SAMEORIGIN",
	"strict-transport-security": "max-age=31536000; includeSubDomains",
	"referrer-policy": "strict-origin-when-cross-origin",
	"permissions-policy": "camera=(), microphone=(), geolocation=()",
	"content-security-policy": "frame-ancestors 'self'",
};

const withSecurityHeaders = (response) => {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(BASELINE))
		if (!headers.has(name)) headers.set(name, value);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
};

const paused = {
	fetch(request) {
		const { pathname } = new URL(request.url);
		if (
			pathname === "/mcp" ||
			pathname === "/answer" ||
			pathname.startsWith("/api")
		) {
			return Response.json(
				{ error: `Helpdock is paused until ${BACK_ON}.` },
				{
					status: 503,
					headers: { "retry-after": RETRY_AFTER, "cache-control": "no-store" },
				},
			);
		}
		if (pathname === "/ready" || pathname === "/health") {
			return new Response("paused", {
				status: 503,
				headers: { "retry-after": RETRY_AFTER, "cache-control": "no-store" },
			});
		}
		return new Response(PAGE, {
			status: 503,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"retry-after": RETRY_AFTER,
				"cache-control": "no-store",
			},
		});
	},
};

export default {
	async fetch(request) {
		return withSecurityHeaders(await paused.fetch(request));
	},
};
