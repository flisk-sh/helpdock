# Helpdock

Your docs, as a help center that answers with sources. Point it at a folder of Markdown; ask in plain words; every answer links the sections it came from.

- **Works without a key.** With no API key it quotes the best passages. Set `ANTHROPIC_API_KEY` and Claude writes the answer from those passages and cites them.
- **No vector database.** Pages are split on headings and searched with Postgres full-text search (`websearch_to_tsquery`, `ts_rank`, `ts_headline`).
- **Also an MCP server.** Claude Code, Cursor or Codex can call `search_docs`, `ask_help_center` and `add_doc`.
- **Runs on your machine.** Built and run with [Flisk](https://github.com/flisk-sh/flisk): one `flisk up` starts Postgres, the migrator, the agent and the MCP server.

## Run it

```bash
flisk up agents
flisk status          # the agent URL, e.g. http://api.helpdock.localhost:8082/api/agent
```

Open the agent URL with a trailing slash in a browser. The first start loads the starter pages (seven pages of the Flisk docs, from `services/agents/agent/seed-docs/`) into the `help_docs` table.

Use your own docs: replace the files in `seed-docs/` and run `bun run seed:pack` in `services/agents/agent` before the first start (the image ships only compiled code, so the pages are packed into `src/seed-docs.generated.ts`). Or add pages at any time:

```bash
curl -s -X POST "$AGENT_URL/docs" -H 'content-type: application/json' \
  -d "$(jq -n --arg m "$(cat billing.md)" '{source:"billing.md", markdown:$m}')"
```

## API

| Route | What it does |
| --- | --- |
| `GET /` | The help center page |
| `POST /turn` | `{"input": "question"}` with an `x-session-id` header → `{reply, sources}`; the session is checkpointed in Postgres |
| `GET /search?q=` | Ranked sections with snippets |
| `POST /docs` | `{"source", "markdown"}` adds or replaces one page |

Settings: `ANTHROPIC_API_KEY` (optional), `HELPDOCK_MODEL` (default `claude-haiku-5-5`), `HELPDOCK_DOCS_DIR`.

---

_Helpdock started from the Flisk agent-stack template. Its notes follow._


[![Uses Flisk CLI](https://img.shields.io/badge/Uses-Flisk%20CLI-blue?style=flat-square&logo=github)](https://github.com/flisk-sh/flisk)

Starter landscape for AI agents on Flisk: a Bun agent resource, an MCP tool server, Postgres, and NATS.

## Prerequisites

- Docker running
- Tilt installed
- Bun installed
- [Flisk CLI](https://github.com/flisk-sh/flisk)

## Quick start


> **Repository-pinned CLI (optional):** Run `bun install` from the repository root to install the version pinned in `package.json`. Use `bun run flisk:project` to initialize project config, `bun run flisk:dry-run` to preview startup, or `bun run flisk:up -- <stack>` to start a stack. The global npm and standalone binary installation paths remain available.

```bash
git clone https://github.com/flisk-sh/flisk-agent-stack.git
cd flisk-agent-stack
flisk project --yes
flisk up
```

Or from the CLI:

```bash
flisk project agent-stack
cd flisk-agent-stack
flisk up
```

## Landscape

| Stack   | Resource        | Type     | Notes                                                                 |
|---------|-----------------|----------|-----------------------------------------------------------------------|
| agents  | agent-migrator  | migrator | Creates the `flisk_agent_sessions` table once, before the agent starts |
| agents  | agent           | agent    | Custom runtime, `durability: postgres`: each turn is checkpointed in Postgres |
| agents  | tools           | mcp      | MCP tool server (Streamable HTTP at `/mcp`), one `echo` tool to replace |
| agents  | postgres        | database | Checkpoint store (`services/platform/database-management`)            |
| agents  | nats            | broker   | Messaging (`services/platform/messaging`), for agents that queue work |

## Try the agent

Once `flisk up agents` is running, find the agent's URL with `flisk networks` and send turns with the `x-session-id` header. Each session keeps its transcript in Postgres, so it survives a restart of the agent:

```bash
AGENT_URL=<the agent URL from flisk networks>
curl -s -X POST -H 'x-session-id: demo' -H 'content-type: application/json' -d '{"input":"hello"}' "$AGENT_URL/turn"
curl -s -H 'x-session-id: demo' "$AGENT_URL/session"
```

`/ready` answers 503 while the checkpoint store is unreachable. The replacement for the placeholder turn lives in `runTurn` in [`services/agents/agent/src/index.ts`](services/agents/agent/src/index.ts).

Scaffold more with:

```bash
flisk resource my-agent --type agent --stack agents --durability files
flisk resource my-tools --type mcp --stack agents
```

See [flisk](https://github.com/flisk-sh/flisk) and the website [llms.txt](https://flisk.sh/llms.txt) for the full contract.
