# Deploy Helpdock at helpdock.flisk.sh

Helpdock online is one Render web service (the `Dockerfile` at the repository root) and one Render Postgres database, both declared in [`render.yaml`](render.yaml). The DNS for flisk.sh is on Cloudflare.

Cost at the plans in `render.yaml`: the Starter web service and the basic-256mb database are paid plans; check Render's pricing page for the current prices before you create them.

## 1. Create the Blueprint on Render

1. Sign in at https://dashboard.render.com with the account that should own Helpdock, and connect GitHub access to `flisk-sh/helpdock` if Render asks.
2. **New → Blueprint**, pick `flisk-sh/helpdock`, branch `main`.
3. Render shows the service `helpdock` and the database `helpdock-db`. It asks for `ANTHROPIC_API_KEY`:
   - leave it empty to run without a model (answers quote the docs, still cited), or
   - paste a key from https://console.anthropic.com. Answers are then written by `claude-haiku-5-5` (change with `HELPDOCK_MODEL`). Set a monthly spend limit on that key; the app allows 60 questions per visitor address per hour (`HELPDOCK_TURNS_PER_HOUR`).
4. **Apply.** Render creates the database, builds the image, runs `migrate` (Prisma `migrate deploy`) before the service starts, and checks `/ready`.
5. When the deploy is live, open the `onrender.com` URL Render shows (for example `https://helpdock.onrender.com/`) and ask a question. The first start loads the seven starter pages.

## 2. Point helpdock.flisk.sh at it

1. In Render: service `helpdock` → **Settings → Custom Domains**. `helpdock.flisk.sh` is already listed from `render.yaml`; Render shows the target it wants, normally `helpdock.onrender.com`.
2. In Cloudflare: zone `flisk.sh` → **DNS → Add record**:
   - Type `CNAME`, Name `helpdock`, Target the value from Render (`helpdock.onrender.com`).
   - Proxy status **DNS only** (grey cloud). Render issues the TLS certificate itself, and the app reads the visitor address from Render's `X-Forwarded-For` (`HELPDOCK_PROXY=last-forwarded`). If you turn the Cloudflare proxy on later, also set `HELPDOCK_PROXY=cloudflare` and restrict the origin to Cloudflare, or rate limits key on Cloudflare's addresses.
3. Back in Render, click **Verify** next to the domain. The certificate is usually issued within minutes.

## 3. Check it

```bash
curl -s https://helpdock.flisk.sh/ready
```

```bash
curl -s -X POST https://helpdock.flisk.sh/turn -H 'content-type: application/json' -H 'x-session-id: smoke' -d '{"input":"How do I run Flisk on Windows?"}'
```

The first should print `{"ready":true,...}`, the second a reply with `sources`.

## Add or replace docs

Writes need the admin token Render generated: service `helpdock` → **Environment** → `HELPDOCK_ADMIN_TOKEN` (reveal it).

```bash
curl -s -X POST https://helpdock.flisk.sh/docs -H "authorization: Bearer $HELPDOCK_ADMIN_TOKEN" -H 'content-type: application/json' -d "$(jq -n --arg m "$(cat billing.md)" '{source:"billing.md", markdown:$m}')"
```

Without the token `POST /docs` answers 403 (the image sets `NODE_ENV=production`).

## What is and is not online

- Online: the page, `POST /turn`, `GET /session`, `GET /search`, and `POST /docs` (admin only).
- Not online: the MCP server (`services/agents/tools`). It stays a local tool you run with `flisk up`; point its `AGENT_URL` at `https://helpdock.flisk.sh` to ask the online help center from Claude Code.
- Limits: 500 characters per question, 60 questions per hour and 300 searches per minute per visitor address, 64 KB request bodies (2 MB for `/docs`), the last 100 messages per session.
- Rate limits are counted in memory, per instance. They reset on each deploy, and two instances would each count separately; keep one instance, or move the counter to Postgres before scaling out.
