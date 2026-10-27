# Configuration and editor schemas

Flisk has two JSON files with different jobs: each service's `service.json` describes that service, and `.flisk/project.json` configures the local project and its stack phases. The schemas help editors provide completion; Flisk's CLI behavior remains authoritative.

## `service.json`

Here is valid JSON; the explanations are outside the file so it remains parseable:

```json
{
  "$schema": "https://flisk.sh/schema.service.json",
  "schemaVersion": 1,
  "appName": "api-backend",
  "appType": "backend",
  "stack": "shop",
  "port": 4000,
  "healthCheckPath": "/health",
  "dependsOn": []
}
```

`appName`, `appType`, `stack`, and `schemaVersion` are required. A backend also needs a port in the supported backend range. See the [authoritative service schema](../runtime/engine/schemas/service-schema.json). The `$schema` property is supported by the schema. `flisk doctor` checks local environment readiness and discovered service issues.

### `smoke`: check the public URL after `flisk up`

`healthCheckPath` is a GET inside the container, and `traefik.healthCheck` is Traefik's own probe. Neither opens the URL `flisk up` prints, so a container can be green while the route is a 404, the router is shared with another backend, or the database is not the one the service uses. A `smoke` block closes that gap:

```json
{
  "smoke": {
    "via": "proxy",
    "timeoutSeconds": 60,
    "steps": [
      { "name": "create", "method": "POST", "path": "/records", "body": { "name": "smoke" }, "expect": 201, "save": { "id": "$.id" } },
      { "name": "read back", "path": "/records/{{id}}", "expect": 200, "bodyContains": "smoke" }
    ]
  }
}
```

- Once Tilt is up, `flisk up` sends each step to the service's public base URL (`http://api.<project>.localhost[:port]/api/<name>` for a backend, `mcp` or bring-your-own service, `http://app.<project>.localhost[:port]/<name>` for a frontend), the same URL `flisk up` prints. `path` must start with `/`; a full URL or relative path is rejected, because it would skip the proxy.
- `expect` is the status (default 200). `bodyContains` is optional. `save` copies a response field (`$.id`, `$.data.items[0].id`) into `{{id}}` for later steps, in the path and in string values of `body`.
- Before the first step, `flisk up` polls `GET <public URL><healthCheckPath>` (default `/health` for backend and `mcp` services; none for frontends and bring-your-own without `healthCheckPath`, which is the setting for a service that is not HTTP) until something other than a connection error, 404 or a 5xx answers, so a write is never the first request to reach a service that is still building or migrating. The wait has its own `timeoutSeconds` budget, and the steps then get a fresh one. If the service never answers, the first step runs anyway and reports the failure.
- A 404, 502, 503 or 504 means the route is not up yet and is retried for `timeoutSeconds` (default 60). A thrown error is retried for GET, HEAD and OPTIONS; for a write (POST, PUT, ...) only when the error proves the request was never sent (connection refused, DNS failure), never after a timeout or reset, which may have reached the service. Any other wrong status fails at once, so a write is never repeated.
- A failed step stops Tilt, prints the service, step, URL, method, status and a body snippet, and makes `flisk up` exit non-zero. The containers are left running for inspection; `flisk down` removes them.
- Every step that ran leaves a record under `.flisk/smoke/<service>/<step-slug>/` (`<step-slug>` is the lowercased step name, or `step-N` when unnamed). `latest.json` holds the service, step, method, public URL, expected and actual status, `truncated`, the byte length and the body file name; `body.txt` holds the response body, capped at 64 KiB (`truncated: true` when the cap cut it). A step that got no response (after retries) writes `latest.json` with `status: null` and the error code, and no body file. When a step passes, `last-success.json` and `last-success-body.txt` are replaced with that response; a failure never touches them, so a later regression can be compared with the last good response (`diff last-success-body.txt body.txt`). The failure line ends with `(record: <path to latest.json>)`. Before the first record is written, `flisk up` makes sure the project `.gitignore` ignores `.flisk/smoke/`, and warns when it cannot; Git ignore does not untrack files that were added before. `flisk down` leaves the records, and nothing is uploaded from your machine; `rm -rf .flisk/smoke/` removes them. Bodies are masked before they are stored or shown: the secret values of the project's `.env` are replaced with `[REDACTED]` in the stored body, in the last-success copy, in the printed snippet, and in the recorded URL and error. That is not a secret scanner: it covers the values the `.env` holds and nothing else, and a project without a `.env` has nothing to mask. When the `.env` exists but cannot be read, the values are unknown, so the runner withholds the body and the URL and keeps only the safe metadata instead of storing unmasked text. Request headers and cookies are not stored.
- No `smoke` block, no check: existing projects behave as before. Workers and bring-your-own services with `exposeViaProxy: false` have no public route and are skipped. `flisk doctor` reports a malformed block, and `flisk up` reports one as a failed smoke check instead of crashing.

Not covered: a browser test (HTTP only), proving which database answered (a read-back of the written id catches a wrong store, not which one), a Traefik `pathPrefix` override (the check uses the `apiPath` or `basePath` route that `flisk up` prints), and `--dry-run` (nothing is started, so nothing is checked). The ingress port is the one `flisk up` selected (`FLISK_HTTP_PORT` or the fallback range).

`tests/e2e/journeys/smoke/verify-smoke.sh` checks both outcomes through a real `flisk up`.

A short drawing of the pass and fail paths: [Smoke check](smoke.md).

## `.flisk/project.json`

`flisk project` creates this file. Here is a minimal valid one; the explanations are outside the file so it remains parseable:

```json
{
  "version": "1.0",
  "project": {
    "name": "shop-app",
    "version": "1.0.0"
  },
  "phases": {
    "pre_alpha": {
      "name": "Pre-Alpha",
      "description": "Core services",
      "enabledStacks": ["shop"]
    },
    "alpha": {
      "name": "Alpha",
      "description": "Essential business services",
      "enabledStacks": []
    },
    "beta": {
      "name": "Beta",
      "description": "Extended features",
      "enabledStacks": []
    },
    "out_of_scope": {
      "name": "Out of Scope",
      "description": "Future releases",
      "enabledStacks": []
    }
  },
  "optional_infra": {
    "monitoring": false,
    "elk": false,
    "debezium": false,
    "golden_image": true,
    "verdaccio": false
  },
  "discovery": {
    "paths": ["services/*/*"]
  }
}
```

- `project`: the project name and version.
- `phases`: all four phases (`pre_alpha`, `alpha`, `beta`, `out_of_scope`) are required, and `enabledStacks` lists the stacks assigned to each phase.
- `optional_infra`: switches for optional platform services such as monitoring and the golden image.
- `discovery.paths`: where Flisk looks for each service's `service.json`. `services/*/*` matches `services/<stack>/<resource>/service.json`.

The schema only gives your editor completion and hints. The CLI stays the source of truth when it reads this file at runtime.

For VS Code, associate both filenames with their schema in workspace settings. The project schema provides editor assistance for the current project configuration shape; it does not add or change CLI validation.

```json
{
  "json.schemas": [
    {
      "fileMatch": ["/services/**/service.json"],
      "url": "https://flisk.sh/schema.service.json"
    },
    {
      "fileMatch": ["/.flisk/project.json"],
      "url": "https://flisk.sh/project-schema.json"
    }
  ]
}
```

The service schema is also in [`runtime/engine/schemas/service-schema.json`](../runtime/engine/schemas/service-schema.json), and the current project configuration schema is [`runtime/engine/schemas/project-schema.json`](../runtime/engine/schemas/project-schema.json). Run `flisk config verify` to check generated project files, validate discovered service manifests, and compare generated service files with their snapshots. It does not validate Helm values. `flisk doctor` checks local readiness and service concerns. See [generated service files](generated-files.md).

### Which diagnostic command should I run?

Use `flisk doctor` to check whether your development environment is ready. Use `flisk config verify` to validate project configuration and check generated-file consistency. These commands answer different questions and are not substitutes for each other.

| What you want to check | Command | What it helps identify |
| --- | --- | --- |
| Local environment readiness | `flisk doctor` | Missing tools, Docker readiness, port conflicts, and reported service or environment issues |
| Project configuration and generated-file consistency | `flisk config verify` | Invalid service manifests, missing or out-of-sync generated project files, and generated service-file drift |

#### Example: Check environment readiness

If Flisk cannot start your development environment, run:

```sh
flisk doctor
```

Review the reported checks and suggested fixes. For example, if Docker is not running, start Docker Desktop or another supported container runtime and run the command again.

See the [doctor readiness contract](reference/doctor-contract.md) for the exact checks, exit codes, and JSON output.

#### Example: Check configuration consistency

If you suspect your configuration or generated files are out of sync, run:

```sh
flisk config verify
```

Review any validation errors or reported differences. For example, if a generated project file has been edited manually, verification can report that it is out of sync and show a diff. Use the reported remediation guidance to address the problem; verification does not automatically regenerate files.

For example, verification may report an out-of-sync generated file and recommend running:

```sh
flisk config regenerate
```

Regenerate only after reviewing the reported differences and confirming that regeneration is appropriate for your changes.

See the [machine-readable CLI reference](reference/machine-readable-cli.md) for the verification result fields and exit behavior. For generated-file drift and regeneration guidance, see [generated service files](generated-files.md).

### The service schema and how it is published

`runtime/engine/schemas/service-schema.json` is the source of truth; the copy at `https://flisk.sh/schema.service.json` is a
deploy artifact for editors. It is only an editor hint. The CLI provider registries are the contract: the CLI rejects an unknown
`framework` or `language` id before it writes a resource. So `framework` and `language` are open strings with an id pattern, their
`examples` are a short hint rather than a list of every provider, and adding a provider never changes the schema.

- **On a pull request**, CI validates the schema offline (`scripts/check-published-service-schema.mjs`). It never fetches the live
  copy, because a PR that changes the schema could never match it before merge.
- **After a change to the schema lands on `main`**, the *Publish service schema* workflow copies it to the Pages repository and then
  reports in its run summary whether the live copy matches. It needs a repository secret named `PAGES_SYNC_TOKEN` (a fine-grained
  token with `contents: write` on `flisk-sh/flisk-sh.github.io`). Without it the copy is skipped with a warning and the live
  copy falls behind `main`; the summary says so.
