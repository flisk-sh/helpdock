// helpdock.flisk.si while Render's free hours are used up: one small page that says so, instead of Render's
// "This service has been suspended." Browsers get the page, /mcp and /answer get a JSON 503, and everything
// carries Retry-After for the day the hours come back. To bring Helpdock back, see paused/README.md.
export const BACK_ON = "1 December 2026";
const RETRY_AFTER = "Tue, 01 Dec 2026 00:00:00 GMT";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Helpdock is paused</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230d7a62'/%3E%3Cpath d='M18 15h8v14h12V15h8v34h-8V36H26v13h-8z' fill='%23fff'/%3E%3C/svg%3E">
<style>
:root{--bg:#eeece5;--fg:#16181d;--mute:#5b6068;--rule:#16181d;--green:#0d7a62}
@media (prefers-color-scheme:dark){:root{--bg:#0d0e12;--fg:#ececf1;--mute:#9aa0aa;--rule:#3a3d46;--green:#6ee7a0}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:38rem;border:1px solid var(--rule);padding:32px}
.tag{margin:0 0 20px;font:500 12px ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--mute)}
h1{margin:0 0 16px;font:800 clamp(28px,6vw,40px)/1.1 ui-serif,Georgia,serif}
p{margin:0 0 16px}
.mute{color:var(--mute)}
ul{margin:0 0 20px;padding:0;list-style:none;border-top:1px solid var(--rule)}
li{border-bottom:1px solid var(--rule)}
a{display:block;padding:12px 0;color:var(--fg);text-decoration:none;font-family:ui-monospace,Menlo,monospace;font-size:14px}
a:hover,a:focus-visible{color:var(--green)}
a span{display:block;font-family:ui-sans-serif,system-ui,sans-serif;color:var(--mute);font-size:13px}
</style>
</head>
<body>
<main>
<p class="tag">helpdock / paused</p>
<h1>Helpdock is paused until ${BACK_ON}.</h1>
<p>Helpdock runs on a free Render plan, and this month's free hours are used up. Render stops the service until the hours come back on ${BACK_ON}.</p>
<p class="mute">Until then, the Flisk docs are still here:</p>
<ul>
<li><a href="https://flisk.sh/docs/">flisk.sh/docs &rarr;<span>the Flisk documentation</span></a></li>
<li><a href="https://github.com/flisk-sh/flisk/tree/main/docs">flisk-sh/flisk docs on GitHub &rarr;<span>the same pages as plain files</span></a></li>
<li><a href="https://github.com/flisk-sh/helpdock">flisk-sh/helpdock &rarr;<span>the source and how to run your own</span></a></li>
</ul>
<p class="mute">Questions: hello@flisk.sh</p>
</main>
</body>
</html>`;

export default {
	fetch(request) {
		const { pathname } = new URL(request.url);
		const headers = { "retry-after": RETRY_AFTER, "cache-control": "no-store" };
		if (pathname === "/mcp" || pathname === "/answer" || pathname.startsWith("/api")) {
			return Response.json(
				{ error: `Helpdock is paused until ${BACK_ON}.` },
				{ status: 503, headers },
			);
		}
		if (pathname === "/ready" || pathname === "/health") {
			return new Response("paused", { status: 503, headers });
		}
		return new Response(request.method === "HEAD" ? null : PAGE, {
			status: 503,
			headers: { ...headers, "content-type": "text/html; charset=utf-8" },
		});
	},
};
