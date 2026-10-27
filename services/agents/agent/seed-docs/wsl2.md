# Flisk on Windows

On Windows, you run Flisk inside the **Ubuntu** app. Ubuntu is a free version of Linux, and [WSL2](start/words.md#wsl2) (Windows Subsystem for Linux) is the part of Windows that runs it, next to your usual Windows apps. You install it once with one command, then type every Flisk command in the Ubuntu app, which is your [terminal](start/words.md#terminal) on Windows.

Why the extra step? Flisk starts your app with Linux tools: Linux [containers](start/words.md#container), [Docker](start/words.md#docker) and [Tilt](start/words.md#tilt). Windows cannot run Linux containers without WSL2.

Just want the short version? [Set up Windows](setup/windows.md) has three steps. Never written code? [Start here](start/first-time.md). This page has every step in detail, an example app to try, and fixes for common problems.

## Support summary

Which Flisk commands work where. In short: on Windows, use the Ubuntu app for everything. Windows on its own ("native Windows") can check your computer and show what Flisk would start, but cannot start your app.

| Platform | `flisk up` | `flisk doctor` | `flisk --version` | `flisk up --dry-run` | Notes |
|----------|------------|----------------|-------------------|----------------------|-------|
| macOS / Linux | ✅ Full runtime | ✅ Full | ✅ | ✅ | Native support |
| **WSL2 Ubuntu** | ✅ Full runtime | ✅ Full | ✅ | ✅ | **Recommended for Windows** |
| Native Windows | ❌ Refused | ✅ Inspection only | ✅ | ✅ Inspection only | See below |

**Bottom line**: Run Flisk from **Ubuntu inside WSL2** for the full stack. Native Windows runs only inspection commands (`flisk --version`, `flisk doctor`, `flisk up --dry-run`); `flisk up` exits with a clear refusal pointing to WSL2.

## Recommended setup: WSL2 Ubuntu with Docker Desktop

### Prerequisites
- Windows 10 22H2+ or Windows 11 (WSL2 requires Windows 10 1903+; 22H2+ recommended for best compatibility)
- WSL2 installed: `wsl --install -d Ubuntu` (or `wsl --install` for default Ubuntu)
- Docker Desktop for Windows with **WSL2 backend** selected
- Admin rights for Docker Desktop installation

### Step-by-step

Do these in order. Each grey box is a [command](start/words.md#command): paste it into the Ubuntu app and press Enter.

1. **Install Docker Desktop with WSL2 backend**
   - Download from [docker.com](https://www.docker.com/products/docker-desktop/)
   - During install, ensure **Use WSL 2 instead of Hyper-V** is checked
   - After install, open Docker Desktop → **Settings → Resources → WSL Integration** → enable for your Ubuntu distro
   - Click **Apply & Restart**

2. **Open Ubuntu (WSL2)**
   - Launch "Ubuntu" from Windows Terminal or Start menu
   - Verify Docker is reachable:
     ```sh
     docker version
     docker compose version
     ```
     Both should print version info without errors.

3. **Install Tilt and Flisk in Ubuntu**
   ```sh
   curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash
   curl -fsSL https://flisk.sh/install.sh | sh
   ```
   Or use Bun/npm:
   ```sh
   bun add -g @flisk-sh/flisk
   # or
   npm install -g @flisk-sh/flisk
   ```

4. **Verify the environment**
   ```sh
   flisk doctor
   ```
   All checks should pass. If any fail, see [Troubleshooting](#troubleshooting) below.

5. **Boot the example stack**
   ```sh
   flisk project example --path "$HOME/flisk-example"
   cd "$HOME/flisk-example"
   flisk project --yes
   sed -i 's/^INFISICAL_ENABLED=.*/INFISICAL_ENABLED=false/' .env
   flisk config verify
   flisk doctor
   flisk up shop
   ```
   The command prints the HTTP port (80, or 8080-8180 on WSL2). Use the printed URLs to access services.

6. **Verify the stack works** (in another Ubuntu terminal)
   ```sh
   export HTTP_PORT=<port printed by flisk up>
   curl -fsS "http://api.flisk-example.localhost:$HTTP_PORT/api/orders/health"
   curl -fsS "http://app.flisk-example.localhost:$HTTP_PORT"
   ```

7. **Clean up**
   Press `Ctrl+C` in the `flisk up` terminal, then run:
   ```sh
   flisk down
   ```

## The one-command demo (WSL2 only)

The shortest path to a running stack:

```sh
flisk demo
```

This clones the starter, installs dependencies, boots the stack, and opens the frontend. **Only works in WSL2 Ubuntu**; native Windows refuses with WSL2 guidance.

## Native Windows: what works and what doesn't

| Command | Native Windows | WSL2 Ubuntu |
|---------|----------------|-------------|
| `flisk --version` | ✅ Prints version | ✅ |
| `flisk doctor` | ✅ Inspection checks | ✅ Full checks |
| `flisk up --dry-run` | ✅ Shows what would start | ✅ |
| `flisk up <stack>` | ❌ Exits 1 with WSL2 guidance | ✅ Boots stack |
| `flisk demo` | ❌ Refuses before cloning | ✅ Full demo flow |

**Why?** `flisk up` needs Linux containers, Docker, and Tilt. Native Windows cannot run Linux containers without WSL2. The CLI refuses early to avoid partial/confusing state.

If you are on native Windows and see:
```
Landscape startup needs Ubuntu on WSL2. Native Windows is inspect-only.
```
→ Open **Ubuntu (WSL2)** and run the commands there.

## Verification checklist

After setup, run these to confirm readiness:

```sh
# 1. Docker reachable
docker ps

# 2. Tilt installed
tilt version

# 3. Flisk installed
flisk --version

# 4. Doctor passes
flisk doctor

# 5. Config verifies (in a project)
flisk config verify
```

All should succeed without errors. If not, see [Troubleshooting](#troubleshooting).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `docker version` fails / "Cannot connect to the Docker daemon" | WSL integration not enabled | Docker Desktop → Settings → Resources → WSL Integration → enable Ubuntu → Apply & Restart → restart Ubuntu |
| `flisk doctor` shows port 80/443/5432 conflict | Another process holds the port | `netstat -ano \| findstr :80` (Windows) or `ss -tlnp \| grep :80` (Ubuntu) → stop the process or set `FLISK_HTTP_PORT` |
| `flisk up` picks port 8080+ instead of 80 | Non-root user cannot bind port 80 on Linux/WSL2 | Expected behavior; use the printed URL with the port. Or run `sudo setcap 'cap_net_bind_service=+ep' $(which docker)` (not recommended) |
| `flisk doctor` warns about `FLISK_BIND_ADDRESS` | Wildcard bind address exposes ports to network | Unset `FLISK_BIND_ADDRESS` to keep ports on `127.0.0.1` |
| `flisk up` fails with "Tilt not found" | Tilt not in PATH | `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh \| bash` then restart shell |
| `bun: command not found` | Bun not installed | `curl -fsSL https://bun.sh/install \| bash` or install via npm |

## What is NOT supported

| Feature | Status | Notes |
|---------|--------|-------|
| Native Windows `flisk up` | Not supported | No Linux container runtime; use WSL2 |
| Docker Desktop without WSL2 backend | Not supported | Hyper-V backend has different networking; use WSL2 backend |
| Windows Containers | Not supported | Flisk generates Linux container configs only |
| ARM64 Windows | Untested | AMD64 only for now |

## CI evidence

Flisk runs automated WSL2 smoke tests on GitHub-hosted `windows-2022` runners with Ubuntu 24.04 WSL2 and Docker Engine inside the distro. The workflow runs on every push to `main` and is a required check.

- Workflow: [🐧 Platforms WSL2 E2E](https://github.com/flisk-sh/flisk/actions/workflows/e2e-platforms-wsl2.yml)
- **Note**: CI uses **Docker Engine inside WSL2**, not Docker Desktop WSL integration. The guide above describes Docker Desktop integration; the two paths are functionally similar but not identical.

## See also

- [Windows hardware checks](windows-hardware.md): Evidence from real Windows machines
- [Troubleshooting](troubleshooting.md): General troubleshooting guide
- [Requirements and support](../README.md#requirements-and-support): Platform support matrix
- [Issue #107](https://github.com/flisk-sh/flisk/issues/107): Windows/WSL2 quickstart test tracking
