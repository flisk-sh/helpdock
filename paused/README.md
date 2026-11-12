# Redirect for helpdock.flisk.si while Helpdock is paused

Render's free hours ran out on 2026-11-12, and every free Render service in the workspace is suspended until 1 December. This Worker answers at helpdock.flisk.si meanwhile: every page redirects (302) to https://flisk.sh/, and `/mcp` and `/answer` answer a JSON 503.

## Put it up

1. Cloudflare, zone `flisk.si`, DNS: delete the `CNAME helpdock -> helpdock.onrender.com` record (DNS only, TTL auto; this is the record to restore later).
2. From this folder: `bunx wrangler@4 deploy`.

## Bring Helpdock back

1. Wait for Render's hours to return (1 December), and check the service resumed in the Render dashboard.
2. Remove the Worker's custom domain (Cloudflare, Workers & Pages, `helpdock-paused`, Settings, Domains), or `bunx wrangler@4 delete helpdock-paused`.
3. Add back DNS: `CNAME helpdock -> helpdock.onrender.com`, DNS only (grey cloud). Re-verify the domain in Render.
4. Put `bar: true` back on Helpdock in flisk-sh/flisk.si `_data/catalog.yml`, the entry back in flisk-sh/website `_data/nav.yml`, and the README badge in flisk-sh/flisk.

Do not add keep-awake pings to the Render service: they are what used the hours up.
