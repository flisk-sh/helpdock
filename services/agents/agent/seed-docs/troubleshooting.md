# Troubleshooting: flisk and Tilt messages and what to do about them

Search this page for the text you saw. Each entry gives the message as Flisk prints it, the cause, the fix, and where in the repository the message is defined. Every entry also says how it was checked:

- **Reproduced:** the output below was captured by running Flisk 1.3.86 (`origin/main` at the time of writing) in a scratch project on macOS. The scratch project's directory is shown as `<project>`. `flisk up` was **not** run for this page, so nothing here was observed while Docker was starting containers.
- **Simulated:** produced by running the real `flisk` against a stand-in for Docker (a small wrapper that makes `docker` fail the way the entry describes). The message and fix are Flisk's own; the Docker failure itself was not real.
- **Read from source, not reproduced:** copied from the code. It is the intended text; whether your situation produces it was not checked.

Where the cause is not known, the entry says so. Messages change between releases: if yours differs slightly, search for the first few words.

Fixes that change files or Docker state, such as `flisk down --prune-networks` or `docker network prune`, affect every project on that Docker daemon, not only the one you are in.

On this page: [before anything starts](#flisk-fails-before-anything-starts) · [doctor failures](#flisk-doctor-fails) · [ports](#ports) · [services not healthy](#services-never-turn-healthy-or-are-left-behind) · [scaffolded code](#scaffolded-code) · [Windows and WSL2](#windows-and-wsl2) · [asking for help](#how-to-ask-for-help)

## flisk fails before anything starts

### `Could not find project root`

```text
$ flisk status        # also: flisk up
Error: Could not find project root (no .flisk/project.json found). Run `flisk project --yes` first.
```

- **Cause:** you ran the command outside a Flisk project. Flisk looks upward from the current directory for `.flisk/project.json`.
- **Fix:** `cd` into the project, or run `flisk project --yes` to create one.
- **Defined in:** [`errors.ts`](../cli/src/utils/errors.ts) (`requireProjectRoot`, `errorFactories.notInProject`). Some commands print the second wording from `errorFactories`, `❌ Could not find project root (no .flisk/project.json found)`, followed by suggestions.
- **Checked:** reproduced (`flisk status` and `flisk up`, exit code 1).

### `unknown option` and `unknown command`

```text
$ flisk resource x --bogus
error: unknown option '--bogus'
$ flisk upp
error: unknown command 'upp'
(Did you mean up?)
```

- **Cause:** a typo, or a flag the command does not have. The exit code is 1.
- **Fix:** `flisk <command> --help` lists the flags.
- **Checked:** reproduced.
- If an older Flisk reports `unknown flag: --force`, upgrade it. Current Flisk accepts the option for script compatibility and does not pass it to Tilt. The historical [pilot report](adopt-flisk.md#2-pilot-in-one-afternoon) ran `tilt down --force` directly, not `flisk down --force`.

### `Stack "x" not found`

```text
$ flisk up nope --dry-run
❌ Stack "nope" not found

💡 Suggestions:
   → Run `flisk stacks` to see available stacks
   → Run `flisk stack` to assign resources to a stack
```

- **Cause:** no resource is assigned to a stack of that name. Stacks are the `<stack>` folder in `services/<stack>/<name>/`.
- **Fix:** `flisk stacks` lists what Flisk found.
- **Defined in:** [`errors.ts`](../cli/src/utils/errors.ts) (`stackNotFound`). `Resource "x" not found` is the same pattern.
- **Checked:** reproduced for the stack message; the resource message was read from source, not reproduced.

### `flisk X is older than the Y this project requires (minFliskVersion)`

```text
$ flisk up shop --dry-run        # same text from flisk up and flisk doctor
flisk 1.3.86 is older than the 9.9.9 this project requires (minFliskVersion)
Run: flisk upgrade
```

With `"minFliskVersion": "abc"` in `.flisk/project.json`:

```text
.flisk/project.json minFliskVersion "abc" is not a version like "1.3.80"
Set minFliskVersion to a MAJOR.MINOR.PATCH string, for example "1.3.80".
```

- **Cause:** the repository pins a minimum CLI version and yours is older, or the pin is not `MAJOR.MINOR.PATCH`. Both stop `flisk up` with exit code 1, before Docker or Tilt are touched.
- **Fix:** `flisk upgrade`, or install a specific version; see [upgrading](upgrading.md). `flisk up --ignore-version` skips the check, which is only sensible when the pin is stale.
- **Defined in:** [`flisk-version.ts`](../cli/src/utils/flisk-version.ts).
- **Checked:** reproduced with a scratch `minFliskVersion` of `9.9.9` and `abc`.

### `Cold start blocked` (Docker or Tilt missing)

`flisk up` checks the machine before anything else. With a Docker that cannot be reached (simulated with a wrapper that answers like a stopped daemon):

```text
$ flisk up shop
Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?
Cold start blocked. Bun/Prisma/NATS are not the first failure.
They are generated after `flisk project`. Fix the machine checks below.
FAIL docker  Docker daemon is not running
  Start Docker Desktop, OrbStack, or Colima, then retry: flisk doctor
FAIL compose Docker Compose plugin not found
  Install Docker Compose: https://docs.docker.com/compose/install/
```

With `tilt` removed from `PATH` (reproduced):

```text
Cold start blocked. Bun/Prisma/NATS are not the first failure.
They are generated after `flisk project`. Fix the machine checks below.
FAIL tilt    Tilt CLI not found
  curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash
```

- **Cause:** no Docker daemon, no Compose plugin, or no Tilt on `PATH`. The Compose line appears with the daemon line here because the stand-in made every `docker` call fail; with a real stopped daemon, whether it also prints is not checked.
- **Fix:** start Docker Desktop, OrbStack or Colima, or install Tilt, then `flisk doctor`.
- **Defined in:** [`cold-preflight.ts`](../cli/src/utils/cold-preflight.ts) and `DOCTOR_FIXES` in [`doctor.ts`](../cli/src/commands/doctor.ts).
- **Checked:** Tilt missing reproduced; Docker down simulated. Other texts in the same family, **read from source, not reproduced**, from [`errors.ts`](../cli/src/utils/errors.ts): `Tilt CLI is not installed`, `Docker (or a compatible container runtime) is not running`, `Docker is running but not responding (`docker ps` hung for 10s)` (fix: quit and reopen Docker Desktop, or `colima restart`), all under `Flisk can't start - missing prerequisites:`.
- **Only `flisk up` is blocked:** `flisk project` writes the project configuration and clones a starter template without a Docker daemon or Tilt, and prints the next step instead. `flisk doctor` remains the explicit readiness check.
- **See also:** [Troubleshoot L1 (base image) build failures](troubleshoot-l1.md) for failures pulling the upstream base image, Alpine package installation errors, or missing golden layers.
- **See also:** [Troubleshoot L2 (dependency layer) build failures](troubleshoot-l2.md) for package installation, lockfile synchronization, and Docker layer caching issues.

### `Out of sync: ...` from `flisk config verify`

```text
$ flisk config verify
🔍 Verifying configuration...

⚠️  Configuration issues found:
   - Out of sync: .flisk/.flisk-out/TILT_TECH_STACK.star (run 'flisk config regenerate')
   - Out of sync: .tiltignore (run 'flisk config regenerate')

--- a/.flisk/.flisk-out/TILT_TECH_STACK.star
+++ b/.flisk/.flisk-out/TILT_TECH_STACK.star
...
Run `flisk config regenerate` to fix.
```

(The diff shows the whole file as changed, with the same text on both sides; only the line you edited differs. This output came from appending one line to each file.)

- **Cause:** a generated file was edited by hand, or `.flisk/project.json` changed since the files were generated. The message appears with the same text for a `.tiltignore` that Flisk wrote and someone edited ([gradual adoption](gradual-adoption.md#your-own-tiltignore) covers a `.tiltignore` Flisk did not write).
- **Fix:** `flisk config regenerate`. It restores a root `.tiltignore` that still carries Flisk's `SYSTEM-GENERATED BY Flisk CLI` header and prints `Restored: .tiltignore → project root (hand edits discarded)`; your edit is gone, so keep a copy if you want it. A `.tiltignore` without that header is never overwritten (it is the team's own). `flisk project --yes` does not restore it. Before this was fixed, `flisk config regenerate` left the edited file as it was and the only way out was to delete the root `.tiltignore` and run `flisk config regenerate` again.
- **Defined in:** [`template-engine.ts`](../cli/src/generator/template-engine.ts) and [`config.ts`](../cli/src/commands/config.ts).
- **Checked:** reproduced, including the failing fix and the workaround.

## flisk doctor fails

`flisk doctor` prints `✗` for a failure, `○` for a skipped check and `ℹ Fix:` under a failure. It exits 1 when any check fails. The JSON form is described in the [doctor contract](reference/doctor-contract.md). The scratch outputs below used `flisk doctor --no-ping`, which does not call running services.

### Docker and Tilt

All **read from source, not reproduced** except where stated. Defined in [`doctor.ts`](../cli/src/commands/doctor.ts) unless noted.

| Message | Fix as printed |
| --- | --- |
| `Docker is not running` / `Docker daemon is not running` (also reproduced through a stand-in, see above) | Start Docker Desktop, OrbStack, or Colima, then retry: `flisk doctor` |
| `Docker daemon is not responding` | Same fix text |
| `Colima is installed but not running` | Same fix text |
| `Docker is using the <os> engine; Flisk requires Linux containers` | Switch Docker Desktop to Linux containers, enable WSL2 integration, then retry `flisk doctor` |
| `Docker is too old for generated healthchecks (they use start_interval)`, followed by the versions found | Update Docker Desktop, or on Linux update `docker-ce` and the `docker-compose-plugin` package. The README states Engine 25+ and Compose 2.20+ |
| `Tilt CLI not found` (reproduced) | The Tilt install script, as in the entry above |
| `Tilt <version> is below the required v0.25.0 floor` | Install Tilt v0.25.0 or newer: https://docs.tilt.dev/install.html |
| `Bun is not available` / `Bun <version> is below the required 1.2.0 floor` | `curl -fsSL https://bun.sh/install \| bash`, or install Bun 1.2.0 or newer. Checked only when the project has generated JavaScript services |

Podman: doctor prints `Podman is running` when it is the runtime it finds, and `Docker daemon is not running` otherwise. Whether a Podman setup can run a whole stack was not checked.

### `Docker cannot create another network: all predefined address pools are in use`

```text
✗ Docker cannot create another network: all predefined address pools are in use. Each Flisk project needs several
ℹ Fix: run flisk down --prune-networks in projects you are not using, or docker network prune (removes all unused networks)
```

- **Cause:** Docker's default address pools are used up. Each Flisk project creates several networks and keeps them after `flisk down`. Docker's own error text is `all predefined address pools have been fully subnetted`; doctor matches `address pools`.
- **Fix:** run `flisk down --prune-networks` in projects you no longer use, or `docker network prune`, which removes every unused network on that Docker daemon, whoever created it. `--prune-networks` was added in [#585](https://github.com/flisk-sh/flisk/pull/585).
- **If you skip doctor:** since [#589](https://github.com/flisk-sh/flisk/pull/589), the `init-networks` resource in Tilt fails with `Failed to create Docker network <name>: <Docker's message>` and exits 1. Before it, the failure was swallowed (the command ended `|| true`), `init-networks` reported success, and the later failure was `network ... declared as external, but could not be found`, which is what [byo.md](byo.md#running-more-than-one-project) and the [moon recipe](recipes/moon.md) describe. The `Failed to create Docker network` text is in [`utils_docker_networks.star`](../runtime/engine/topologies/tilt/common/utils_docker_networks.star).
- **Checked:** the doctor message is **simulated** (the stand-in `docker` failed `network create` with Docker's text). The `init-networks` and `declared as external` messages are **read from source and docs, not reproduced**; this machine's Docker pools are in use by other people's work and were not touched.

Note that `flisk doctor` itself runs `docker network create flisk_doctor_probe_<pid>` and removes it, to test whether a network can be created.

### Environment variables

```text
$ flisk doctor --no-ping      # no .env file
✗ Missing required env variables: TILT_ENV, DB_PASSWORD
ℹ Fix: No .env file yet. Run `flisk project` to create one with working defaults.

# .env exists but TILT_ENV was deleted from it
✗ Missing required env variables: TILT_ENV
ℹ Fix: Edit .env and set these values:
    TILT_ENV=<value>

# DB_PASSWORD= is present but empty
✗ Invalid env variables: DB_PASSWORD is set but empty
ℹ Fix: Edit .env and provide values for empty variables
```

- **Cause:** a required key is absent or empty in the project `.env`. See [environment](environment.md).
- **Fix:** as printed. `flisk project` writes a `.env` with working defaults and does not need Docker.
- **Defined in:** [`doctor.ts`](../cli/src/commands/doctor.ts) (`checkEnvironmentVariables`) and [`env-validator.ts`](../cli/src/utils/env-validator.ts).
- **Checked:** reproduced, all three. When only a warning applies, doctor passes and appends `(warning: ...)`; for example a `DATABASE_URL` password that differs from `DB_PASSWORD` (read from source, not reproduced).

### Project files that do not match what Flisk expects

```text
✗ 1 resource without a package.json: billing-api. The image build stops at "COPY .../package.json: not found"
ℹ Fix: Add a package.json next to each service.json (copy one from a working resource), or delete the folder's service.json if it is not a service

✗ Services missing required package.json scripts:
    orders-api: missing "build"
ℹ Fix: Add the missing scripts to each service's package.json, e.g.:
    "dev": "bun run src/index.ts",
    "build": "tsc",
    "start": "bun run dist/index.js"

✗ 1 resource outside discovery.paths ["services/*/*"]: other/deep/x/billing-api. `flisk up` will not start them
ℹ Fix: Move each under services/<stack>/<name>, or add a matching pattern to discovery.paths in .flisk/project.json and run: flisk config regenerate

✗ Master configs missing: TILT_TECH_STACK.star
ℹ Fix: Run: flisk project
```

- **Cause and fix:** as printed. The last one also produces a second failure, `Starlark load() issues will stop Tilt before services start:`, listing the missing file; its fix is `flisk config regenerate`.
- **Defined in:** [`doctor-wiring.ts`](../cli/src/utils/doctor-wiring.ts) (package.json), [`doctor.ts`](../cli/src/commands/doctor.ts) (scripts, discovery, master configs, Starlark).
- **Checked:** reproduced, each by changing one thing in a scratch project. A defect was noted in [adopt-flisk.md](adopt-flisk.md#2-pilot-in-one-afternoon): on the code that page was written against, `N resources without a package.json` was also reported for bring-your-own resources. It was not re-run for this page.

### `Backends without a health route`

```text
✗ Backends without a health route (the container never turns healthy, so Traefik returns 404):
    orders-api: no "/health" route in src/ (probed by the container and Traefik healthchecks)
ℹ Fix: Add the route, e.g. for Hono: app.get("/health", (c) => c.json({ status: "ok" })). To use a different path, set "healthCheckPath" (container healthcheck) or "traefik.healthCheck" (Traefik) in its service.json.
```

- **Cause:** the check searches `src/` for the health path from `service.json` and found none. The scratch case renamed `/health` to `/healthz` in a scaffolded backend. Per the message, a service with no health route never turns healthy and Traefik answers 404 for it; that part was not observed, because `flisk up` was not run.
- **Fix:** add the route, or point `healthCheckPath` and `traefik.healthCheck` at the path you use.
- **Defined in:** [`doctor-runtime.ts`](../cli/src/utils/doctor-runtime.ts).
- **Checked:** reproduced (the doctor message only).

### `Unknown service.json field ...: unknown field is preserved`

```text
⚠️  <project>/services/shop/orders-api/service.json.healthCheck: unknown field is preserved
```

- **Cause:** `service.json` has a key Flisk does not know. Flisk leaves it in place. The scratch case added `"healthCheck": "/health"` by hand; doctor still exited 0.
- **Fix:** none required. Remove the field, or fix its spelling, if you expected it to do something. [Pilot Flisk on a real repository](adopt-flisk.md#2-pilot-in-one-afternoon) records that on Flisk 1.3.86 a freshly scaffolded service produced this for `healthCheck`; a service scaffolded by the version used for this page did not.
- **Defined in:** [`service-manifest.ts`](../cli/src/utils/service-manifest.ts). The warning's wording was `Unknown service.json field: ...` in the earlier capture and is `<path>.<field>: unknown field is preserved` now.
- **Checked:** reproduced.

### Other doctor failures, read from source

All **read from source, not reproduced**.

| Message (start of it) | Cause as the message states it | Fix as printed | Defined in |
| --- | --- | --- | --- |
| `N Tilt processes are running for this project (pids ...). They fight over ports and containers` | More than one Tilt for this project | `flisk down && kill <pids> && flisk up` | `doctor-wiring.ts` |
| `Another project's Tilt is running: ...` | Another project's Tilt holds a UI port | `flisk up` uses the next free Tilt UI port (10351, ...); if it is a leftover, run `flisk down` in that project | `doctor-wiring.ts` |
| `N migration command(s) run from a backend or worker's own start-up` | A service migrates on every start | Move the migration into a `migrator` resource the service depends on; see [byo](byo.md#one-shot-jobs-migrations-seeders) | `doctor-wiring.ts` |
| `N service URL(s) in params that cannot connect` | A URL in `params` points at the wrong port | Containers reach each other as `http://<resource>:<port>`, using the `port` in that service's `service.json` | `doctor-wiring.ts` |
| `N frontend call(s) to a backend port that Flisk does not publish on localhost` | A frontend calls `localhost:<backend port>` | Use the Traefik URL `http://api.<project>.localhost/api/<name without -api>/...` | `doctor-wiring.ts` |
| `... enable the nats feature, but no NATS server will start` | `services/platform/messaging/docker-compose.yml` is missing and Flisk does not generate it | Create it with a `nats` service and a `redis` service, as the Fix line describes | `doctor-wiring.ts` |
| `Generated Dockerfiles reference missing project runtime assets` | Generated files are older than the CLI | `flisk project --yes` or `flisk config regenerate` with an updated Flisk | `doctor.ts` |
| `Starlark load() issues will stop Tilt before services start` | A generated `.star` file loads something that is missing | `flisk config regenerate` | `doctor.ts` |
| `bun run build` will fail with TS2688 (Cannot find type definition file) | A `types` entry in the Docker tsconfig has no `@types` package in `devDependencies` | Add the packages the Fix line lists | `doctor.ts` |
| `Frontend Docker metadata has issues that will make flisk up fail or route 404` | Generated frontend metadata is stale | `flisk config regenerate`; make sure the nginx runtime routes to port 80 | `doctor.ts` |
| `N container(s) pinned near its memory limit while burning CPU -- likely stuck in a boot-time retry/fetch loop` | Cause is not known; the message suggests a boot-time retry loop | Read `docker logs <container>`; the Fix line names `AUTO_MIGRATE=false` as a temporary unblock when a Prisma auto-migration is the cause | `doctor.ts` |
| `Tilt reports N failed resource(s):` | A Tilt resource failed to update | Read the resource's log in the Tilt UI or `flisk logs` | `doctor-runtime.ts` |
| `Private npm registry (Verdaccio) is not reachable at ...` | Verdaccio is expected by the project but not answering | Start it as the Fix line says. Verdaccio needs a Premium licence ([features](FEATURES.md)) | `doctor-runtime.ts` |
| `Tilt is not running - skipped resource status check` (a skip, not a failure) | You have not run `flisk up` | `flisk up` | `doctor-runtime.ts` |

## Ports

### `Traefik cannot bind ingress ports because another container already owns them`

```text
✗ Traefik cannot bind ingress ports because another container already owns them:
    <container name> (host ports <ports>)
ℹ Fix: Stop the foreign container(s), e.g. `docker stop <container name>`, or shut down the other Flisk/Tilt project using that Traefik. Then re-run `flisk up`.
```

- **Cause:** a Docker container that is not this project's already publishes the ingress ports (80 and 443 when they are free, otherwise 8080 and 8443).
- **Fix:** stop that container only if it is yours to stop, or move Flisk to other ports with `FLISK_HTTP_PORT`, `FLISK_HTTPS_PORT` and `FLISK_POSTGRES_PORT`. On a shared Docker daemon the container may belong to someone else.
- **Defined in:** [`doctor-runtime.ts`](../cli/src/utils/doctor-runtime.ts) (`checkIngressPorts`).
- **Checked:** read from source, not reproduced; it needs a second container on the ingress port.

### `Ports Flisk needs are taken`

```text
✗ Ports Flisk needs are taken:
    5432 (<name>) is used by a program on this machine; inspect it with lsof -nP -iTCP:5432
ℹ Fix: Stop local Postgres or change the host port. Then: flisk doctor
```

The same check prints `Stop the process bound to port 80, or stop local nginx/caddy. Then: flisk doctor` when the first port found taken is 80, and for 443 `Stop the process bound to port 443. Then: flisk doctor`. The names in the middle line come from `HOST_PORTS` in the source; the exact label text was not captured.

- **Cause:** something other than this project holds 5432, 80 or 443 (a local Postgres is the case the message is written for). With Docker holding 5432, the line says `is published by container <name>`.
- **Fix:** stop the program, or choose other host ports with `FLISK_POSTGRES_PORT`. The default host ports are 80 and 443 for HTTP and HTTPS, and 15432 for Postgres (Flisk does not try 5432). Flisk picks the next free one when a default is busy; see [the FAQ](faq-teams.md#ports-and-running-two-stacks-at-once). How the 5432 check relates to the default of 15432 was not investigated.
- **Defined in:** [`doctor-runtime.ts`](../cli/src/utils/doctor-runtime.ts) (`checkHostPorts`).
- **Checked:** read from source, not reproduced.

### `FLISK_HTTP_PORT=... is already in use`

```text
$ FLISK_HTTP_PORT=18777 flisk up shop --dry-run      # something already listening on 18777
Error: FLISK_HTTP_PORT=18777 is already in use. Choose a free host port and retry.

$ FLISK_HTTP_PORT=18777 flisk doctor --no-ping
✗ FLISK_HTTP_PORT=18777 is already in use. Choose a free host port and retry.
ℹ Fix: Set FLISK_HTTP_PORT, FLISK_HTTPS_PORT, or FLISK_POSTGRES_PORT to available host ports.
✗ Ingress port plan is unavailable
```

- **Cause:** you set the variable explicitly and that port is taken. Flisk does not fall back to another port when you chose one, and it does not stop the program using it.
- **Fix:** pick a free port. Without the variable, Flisk picks the next free one itself.
- **Defined in:** [`host-port-plan.ts`](../cli/src/utils/host-port-plan.ts).
- **Checked:** reproduced with a stand-in listener.

### `No available host port in ... for ...`

```text
No available host port in 15432-15532 for postgres. Set FLISK_POSTGRES_PORT to a free port and retry.
```

- **Cause:** every candidate port for that service is taken, usually because many projects are running. HTTP, HTTPS and Postgres each have a range of 101 ports (8080-8180, 8443-8543 and 15432-15532). Every project takes a Postgres port from its range, so at most 101 projects fit with the defaults, fewer if other programs hold ports in it. HTTP and HTTPS try 80 and 443 first and take a port from their range only when that port is not usable, so the first project does not use up a range port. The message names the first service whose candidates run out. That is `postgres` when 80 and 443 are both usable, `ingressHttp` when 80 is not (it is taken, or on Linux and WSL2 a non-root user cannot check it), and `ingressHttps` when only 443 is not.
- **Fix:** stop projects you no longer need with `flisk down`, or set the variable the message names for this project: `FLISK_HTTP_PORT` for `ingressHttp`, `FLISK_HTTPS_PORT` for `ingressHttps`, `FLISK_POSTGRES_PORT` for `postgres`. The ranges cannot be changed. An override is used as-is: if that port is taken, Flisk reports it instead of picking another.
- **Defined in:** [`host-port-plan.ts`](../cli/src/utils/host-port-plan.ts).
- **Checked:** read from source, and the planner (not `flisk up`) was exercised with a stubbed port probe in `host-port-plan.test.ts`; not reproduced with real concurrent projects.

### `Port 10350 is already in use` / `Auto-switching to port ...`

```text
⚠️  Port 10350 is already in use
🔄 Auto-switching to port <port>
```

- **Cause:** another process, usually another project's Tilt, already uses Tilt's UI port 10350. Flisk uses the next free port, so the Tilt UI for this project is at that port, not 10350.
- **Fix:** none needed; open the UI on the port printed. If the other Tilt is a leftover, `flisk down` in that project.
- **Defined in:** [`up.ts`](../cli/src/commands/up.ts). With `flisk up --only`, a Tilt that is already running stops it with `A Tilt is already running on port ...: run `flisk down` first, or pass --force to replace it.`
- **Checked:** read from source, not reproduced; it is printed after the dry-run exit point, so it needs a real start.

### Two services on the same port, no message at all

`flisk resource a --port 4000` followed by `flisk resource b --port 4000` created both resources, with `"port": 4000` in each `service.json`, and `flisk doctor --no-ping` passed. There is no warning. Without `--port`, `flisk resource` picks the next free port in 4000-5999. Whether two services on one port fail at `flisk up` was not checked. Use distinct ports.

## Services never turn healthy, or are left behind

### `HTTP 404: Traefik is answering but has no route for this URL`

```text
✗ N service(s) not healthy (M/K healthy):
    <name> (HTTP 404: Traefik is answering but has no route for this URL (container not started yet, or not running))
      <url>
ℹ Fix: If `flisk up` just started, images may still be building: re-run `flisk doctor` in a minute. Otherwise check `docker ps` and the resource in the Tilt UI, and compare `flisk networks` with the URL above.
```

A 502, 503 or 504 prints `Traefik found the route but the container isn't answering (still starting, or unhealthy)` instead.

- **Cause:** per the message, Traefik is up and no running container is registered for that URL. The reasons the source gives are a service still building or not started. [Backends without a health route](#backends-without-a-health-route) is one way a container never becomes healthy.
- **Fix:** wait and re-run `flisk doctor`; otherwise check the resource in the Tilt UI and `flisk networks`.
- **Seen once with a puzzle:** during earlier work on this repository, doctor printed this 404 right after startup for a URL that had already answered 200 when fetched directly. That was not investigated, so a 404 right after startup is not proof the service is broken.
- **Defined in:** [`doctor-runtime.ts`](../cli/src/utils/doctor-runtime.ts) (`describeProbeFailure`, `summarizeServiceProbes`).
- **Checked:** read from source, not reproduced. A 404 stub on the ingress port could not be tried, because Flisk moved to the next free port while the stub was listening.

### `flisk down` left containers running

Before [#585](https://github.com/flisk-sh/flisk/pull/585), `flisk up shop` started Tilt with `--focus=shop` but `flisk down` ran `tilt down` without it, so the stack's own containers were never removed, and a live `tilt up` could re-create a container right after it was removed. The PR changed `flisk down` to pass every discovered stack, to stop this project's own `tilt up` first, and added `flisk down --prune-networks`. Networks created by `init-networks` are kept after `flisk down` unless you pass it.

- **Fix:** use a version that includes #585, then `flisk down`. On an older version, `docker ps` shows what is left; stop only containers whose names start with your project's.
- **Checked:** read from the PR description and merged change, not reproduced.

## Scaffolded code

### Frontend `bun run build` stops with `.autogenerated/vite.config... does not exist yet`

```text
$ bun run build          # in a scaffolded frontend, before any flisk up
.autogenerated/vite.config.build.autogenerated.ts does not exist yet. Flisk engine writes it when flisk up loads this resource (needs Docker); flisk resource and flisk config regenerate do not create it. Run flisk up <stack> once, or point this script at your own Vite config to build on the host.
error: script "prebuild" exited with code 1
```

- **Cause:** by design. The Vite config is written by the engine when `flisk up` loads the resource, not by `flisk resource`. `dev` has the same guard with `vite.config.frontend.autogenerated.ts`.
- **Fix:** run `flisk up <stack>` once, or point the script at your own Vite config.
- **Defined in:** [`resource.ts`](../cli/src/commands/resource.ts) (`requireGeneratedViteConfig`).
- **Checked:** reproduced (`prebuild` only; the exit code of the script is 1).

### `TS2591: Cannot find name 'process'` in an older scaffold

```text
src/index.ts(33,14): error TS2591: Cannot find name 'process'.
```

- **Cause:** older scaffolds had no `types` in `tsconfig.json`, and TypeScript 7 does not include `@types/*` on its own. The Docker image was not affected, because it uses the engine's own tsconfig. Fixed for new scaffolds in [#586](https://github.com/flisk-sh/flisk/pull/586). That PR also records `Cannot find name 'Buffer'` for an `mcp` scaffold.
- **Fix:** in an older service, add `"types": ["node"]` under `compilerOptions` in `tsconfig.json` by hand. A service scaffolded by the current code already has it.
- **Checked:** the current scaffold was seen to contain `"types": ["node"]`; the error itself was **read from the PR, not reproduced**, because it needs an older scaffold.

## Windows and WSL2

Native Windows can run `flisk doctor` and inspect a project; starting needs WSL2. Setup and the smoke run are in [WSL2 setup](wsl2.md#troubleshooting). All entries here are **read from source, not reproduced** (no Windows machine was used).

| Message | Fix as printed | Defined in |
| --- | --- | --- |
| `Native Windows landscape boot is unsupported. Use WSL2 Ubuntu with Docker Desktop integration. Guide: docs/wsl2.md` | Use WSL2 Ubuntu with Docker Desktop integration | `doctor.ts` |
| `Docker Desktop is using Windows containers. Switch to Linux containers. Flisk stacks are Linux images.` | Switch Docker Desktop to Linux containers | `windows-doctor.ts` |
| `tilt.exe not found on PATH. Install Tilt from https://docs.tilt.dev/install.html` | Install Tilt | `windows-doctor.ts` |
| `Windows reserved port(s) ... for Hyper-V/WSL ...` | The message suggests `net stop winnat` then `net start winnat` in an Administrator terminal, or changing Flisk's ports | `windows-doctor.ts` |
| `Windows did not resolve *.flisk.localhost to 127.0.0.1. Browser URLs with hostnames will fail until you fix hosts or use the 127.0.0.1 URLs printed by flisk networks.` | Fix hosts, or use the `127.0.0.1` URLs from `flisk networks` | `windows-doctor.ts` |
| `WSL2 detected. Use Docker Desktop WSL integration. Guide: docs/wsl2.md ... Project is under /mnt/c (...); hot reload may be broken.` (a warning; a failure with `--strict`) | Move the repository under your WSL home directory, for example `~/projects` | `doctor.ts` |
| Docker unreachable from WSL2 (`docker version` cannot reach the server) | Enable the distribution under Docker Desktop **Resources → WSL Integration** and restart Ubuntu ([wsl2.md](wsl2.md#troubleshooting)) | `wsl2.md` |

The same source files hold messages for [agent hosts](agent-hosts.md) such as Dev Containers and WebContainers (`agent-host.ts`); they were not collected here.

## How to ask for help

If the page does not cover it, or the fix did not work:

1. Run `flisk --version` and `flisk doctor` in the project, and keep the output. Add `--no-ping` if no stack is running.
2. Open a [bug report](https://github.com/flisk-sh/flisk/issues/new?template=bug_report.yml). It asks for the `flisk doctor` output, the Flisk version and your operating system, and for the steps to reproduce.
3. Include the exact message, not a paraphrase, and say whether `flisk up` got as far as starting Tilt.
4. For questions that are not bugs, and for what to expect from maintainers, see [SUPPORT.md](../.github/SUPPORT.md).

Do not paste your `.env`: it holds a generated database password and JWT secret.
