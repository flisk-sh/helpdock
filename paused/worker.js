// helpdock.flisk.si while Render's free hours are used up: send visitors to flisk.sh instead of Render's bare
// "This service has been suspended." /mcp and /answer get a JSON 503, so tools see a clear error rather than a web
// page. The redirect is a 302 (temporary): to bring Helpdock back, see paused/README.md.
export const BACK_ON = "1 December 2026";
export const TARGET = "https://flisk.sh/";
const RETRY_AFTER = "Tue, 01 Dec 2026 00:00:00 GMT";

export default {
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
		return new Response(null, {
			status: 302,
			headers: { location: TARGET, "cache-control": "no-store" },
		});
	},
};
