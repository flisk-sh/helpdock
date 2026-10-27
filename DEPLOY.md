# Deploy Helpdock at helpdock.flisk.sh (free)

Helpdock online is one Render web service on the free plan (the `Dockerfile` at the repository root, declared in [`render.yaml`](render.yaml)) and one Neon Postgres database on Neon's free plan. The DNS for flisk.sh is on Cloudflare.

What free means here (checked 2026-10-27; providers change their free tiers, so re-check before relying on it):

- **Render free web service:** sleeps after 15 minutes without traffic; the next visit wakes it in about a minute. 750 free instance hours per workspace per month. Custom domains are allowed. https://render.com/docs/free
- **Neon free Postgres:** permanent, 1 GB storage, 100 compute-hours per month, suspends after 5 idle minutes and wakes on the next query. No card. https://neon.com/pricing
- Render's own free Postgres is not used: it is deleted 30 days after creation.

For a launch day with real traffic, the sleep is the cost of free: switch the web service to a paid plan for that day (`plan: starter` in `render.yaml`) and back afterwards.

## 1. Create the database on Neon

1. Sign up at https://neon.tech (GitHub sign-in works) and create a project, for example `helpdock`, in **AWS Europe (Frankfurt)** to sit next to the Render region.
2. On the project dashboard, **Connect** → pick the role and the database, turn **Connection pooling off** (Prisma migrations need the direct connection), and copy the connection string. It looks like `postgresql://USER:PASSWORD@ep-....eu-central-1.aws.neon.tech/neondb?sslmode=require`.
   - If the string ends in `&channel_binding=require`, remove that part; keep `?sslmode=require`.

## 2. Create the Blueprint on Render

1. https://dashboard.render.com → **New → Blueprint** → `flisk-sh/helpdock`, branch `main`.
2. Render lists one service, `helpdock`, on the **Free** plan. It asks for one value, `DATABASE_URL`: paste the Neon connection string. There is no AI key to set: Helpdock calls no model. Answers quote the docs with citations, and visitors who want a written answer take it to their own AI (the *Ask your AI* buttons, or the MCP endpoint).
3. **Apply.** Render builds the image and starts it. On every start the container applies the migrations (`migrate`, Prisma `migrate deploy`), then starts the agent; the first start also loads the seven starter pages. Render waits for `/ready`.
4. Open the `onrender.com` URL Render shows (for example `https://helpdock.onrender.com/`) and ask a question.

## 3. Point helpdock.flisk.sh at it

1. In Render: service `helpdock` → **Settings → Custom Domains**. `helpdock.flisk.sh` is listed from `render.yaml`; Render shows the target, normally `helpdock.onrender.com`.
2. In Cloudflare: zone `flisk.sh` → **DNS → Add record**: type `CNAME`, name `helpdock`, target the value from Render, proxy status **DNS only** (grey cloud).
   - Render issues the TLS certificate (Let's Encrypt or Google Trust Services; both are allowed by flisk.sh's CAA records).
   - The app reads the visitor address from Render's `X-Forwarded-For` (`HELPDOCK_PROXY=last-forwarded`). If you turn the Cloudflare proxy on later, also set `HELPDOCK_PROXY=cloudflare`, or rate limits key on Cloudflare's addresses.
3. Back in Render, click **Verify** next to the domain.

## 4. Check it

```bash
curl -s https://helpdock.flisk.sh/ready
```

```bash
curl -s -X POST https://helpdock.flisk.sh/turn -H 'content-type: application/json' -H 'x-session-id: smoke' -d '{"input":"How do I run Flisk on Windows?"}'
```

The first prints `{"ready":true,...}` (after up to a minute if the service was asleep), the second a reply with `sources`.

## Add or replace docs

Writes need the admin token Render generated: service `helpdock` → **Environment** → `HELPDOCK_ADMIN_TOKEN`.

```bash
curl -s -X POST https://helpdock.flisk.sh/docs -H "authorization: Bearer $HELPDOCK_ADMIN_TOKEN" -H 'content-type: application/json' -d "$(jq -n --arg m "$(cat billing.md)" '{source:"billing.md", markdown:$m}')"
```

Without the token `POST /docs` answers 403 (the image sets `NODE_ENV=production`).

## What is and is not online

- Online: the page, `POST /turn`, `GET /session`, `GET /search`, `POST /mcp` (public, read-only: `search_docs`, `ask_help_center`), and `POST /docs` (admin only).
- Visitors' own AI: add `https://helpdock.flisk.sh/mcp` as a remote MCP server (Streamable HTTP, no auth) in Claude, ChatGPT, Cursor or Codex.
- Not online: the local tools server (`services/agents/tools`) with `add_doc`. It stays a tool you run with `flisk up`.
- Limits: 500 characters per question, 60 questions per hour and 300 searches or MCP calls per minute per visitor address, 64 KB request bodies (2 MB for `/docs`), the last 100 messages per session.
- Rate limits are counted in memory. They reset whenever the free service sleeps or redeploys; that is acceptable for a demo, not for abuse protection under load.
