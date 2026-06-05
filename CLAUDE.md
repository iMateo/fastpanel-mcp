# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP (Model Context Protocol) server that exposes a FastPanel 2 hosting panel's REST API as tools. It runs over stdio and is consumed by Claude Code, Claude Desktop, Cursor, etc. The entire server is ~850 lines across four `src/` files.

## Commands

```bash
pnpm build        # tsc → dist/ (the published artifact; bin is dist/index.js)
pnpm typecheck    # tsc --noEmit — run this to validate changes; there is no test suite
pnpm dev          # tsx watch src/index.ts — hot-reload for local iteration
pnpm inspect      # MCP Inspector GUI against dist/index.js
pnpm start        # node dist/index.js
```

There are no unit tests and no linter. The only runtime check is `scripts/smoke.mjs`, which spawns the built server, runs `initialize` → `tools/list`, and calls the read tools against a live panel:

```bash
FASTPANEL_URL=… FASTPANEL_TOKEN=… node scripts/smoke.mjs
```

Always `pnpm build` before running smoke or inspect — they execute `dist/`, not `src/`.

## Architecture

Four layers, registered in `index.ts:main()`:

- **`config.ts`** — `loadConfig()` reads env (`FASTPANEL_URL`, `FASTPANEL_TOKEN`, optional `FASTPANEL_WRITE_TOKEN`, `FASTPANEL_INSECURE_TLS`, `FASTPANEL_TIMEOUT_MS`, and the optional `FASTPANEL_SSH_*` block) and throws on missing required vars. The dual-token split lives here: `writeToken` is `null` when unset; `ssh` is `null` until `FASTPANEL_SSH_HOST` is set.
- **`client.ts`** — `FastPanelClient` wraps `undici` with one persistent `Agent`. `get()` uses the read token; `post/patch/put/delete()` set `requiresWrite:true` and use the write token, throwing `FastPanelWriteDisabledError` if it's null. `>=400` responses throw `FastPanelError` carrying status + parsed body.
- **`ssh.ts`** — `SshClient` shells out to the operator's own `ssh` (via `execFile`, no library dep, no local shell) to run commands on the panel host. Opt-in and host-agnostic — nothing about a specific server is baked in; host/user/port/key all come from `FASTPANEL_SSH_*`. `exec()` resolves with stdout/stderr/exit code (does not throw on non-zero, so callers can read e.g. `nginx -t` failures); throws `SshDisabledError` when SSH is unconfigured. Dynamic values interpolated into remote commands MUST go through `shq()`.
- **`tools.ts`** — `registerTools(server, client, ssh)` registers every tool. This is where all FastPanel API knowledge lives.

### How a tool is built

Each tool is a `server.tool(name, description, zodSchema, handler)`. Handlers wrap the body in try/catch and return either `asJsonText(data)` or `asError(err)` — errors never throw out of a handler, they become `isError` tool results.

### The write-safety model (do not weaken this)

Every mutating tool takes `confirm: boolean` and `dry_run: boolean` and routes through `writeGuard()`:

1. `dry_run:true` → returns the would-be payload as a preview, **no network call**.
2. `dry_run:false` + `confirm:false` → **throws**, refusing to execute.
3. `confirm:true` → proceeds.

Additionally: writes require the write token (enforced in the client), every executed write is logged to **stderr** via `logWrite()`, and any payload containing `password`/`secret` keys must be passed through `redactPasswords()` before it appears in a dry-run preview or log. When adding a write tool, preserve all of these.

## FastPanel API quirks (reverse-engineered — there is no OpenAPI spec)

These are load-bearing; they were discovered from the panel's SPA bundle and live DevTools captures, and are duplicated into tool descriptions so the LLM sees them at call time:

- **List endpoints need wrapped filter params:** `filter[limit]=…&filter[type]=…`. Bare `?limit=…` is silently ignored.
- **Single-resource GETs wrap the object in `{data: …}`:** `GET /api/sites/{id}` and `GET /api/sites/{id}/configuration` return `{data: {...}}`, not the bare object — read `resp.data.index_dir`, not `resp.index_dir`. (The log endpoint is the exception: it returns `{errors: …}` at the root.) Any tool that fetches a site to read its fields must unwrap `.data` first.
- **Site creation is a two-step wizard, not a REST create:** `POST /api/master/domain` (probes for existing email/DNS zones) → `PUT /api/master` (creates site + optional user/db/ftp atomically). There is no `POST /api/sites`. `site_create` hides this; it bails if the probe finds pre-existing zones it can't handle.
- **SSL attach/detach goes through the site, not a cert endpoint:** `PUT /api/sites/{id}` with a `certificate` field (`null` to detach). There is no `POST /api/sites/{id}/certificate`.
- **The `backend` field in site configuration is polymorphic:** a PHP-FPM pool config when `handler=php_fpm`, an Apache VirtualHost block when `handler=fcgi`.
- **Several ops are async:** cert issuance (`certificate_create_letsencrypt`) and backend updates return immediately with `CREATING`/`UPDATING`. Poll `queue_active` to track them.
- **Log tailing is `GET /api/sites/{id}/log/{lines}/{type}`** (type ∈ `frontend_access`/`frontend_error`/`backend_access`/`backend_error`). Quirk: it returns the log tail in an `errors` JSON field with **HTTP 400 even on success** (empty log = `"\n"`, missing file = a `Path … not exists` message). `site_logs` normalises this. Files live at `<user_home>/data/logs/<domain>-<type>.log`.
- **The API is split into lazy-loaded Angular chunks.** Only core routes (sites, users, queue) are in `main-es2015.*.js`; databases/dns/certs/logs/backup live in numbered chunks (`{id}-es2015.{hash}.js`) whose hashes are mapped in `runtime-es2015.*.js`. To reverse-engineer a new endpoint: download the chunks, grep for `` `/api/… ``. Discovered but not yet wrapped: DB dump/restore (`GET /api/databases/{id}/dump?access_token=…` download, `POST /api/databases/{id}/dump/upload?file=…` then `POST /api/databases/{id}/dump`), v2 backup plans (`/api/v2/backup/plans…`), site delete (`/api/sites/{id}/delete`), backend lifecycle (`/api/sites/backend/{id}/restart|start|stop|enable|disable`).
- **PHP versions are dotless enums:** `"74"`, `"80"`, `"82"`, `"83"`, `"84"`.
- **Backend updates use the backend id, not the site id:** `PUT /api/sites/backend/{backend_id}` where `backend_id = main_backend.id` from `site_get` — passing a site id 404s. `site_backend_update` takes a site id and resolves the backend id internally.
- **Document root lives on the site, not the backend:** nginx renders `root` from `site.index_dir`. `site_backend_update` does NOT change it; `site_update` (PUT `/api/sites/{id}`) does. The `index_dir` write path is reverse-engineered and unverified — see the tool's warning.
- **`site_configuration_update` — the API requires all three** of `frontend`/`backend`/`phpini`, but the tool now accepts partial input and back-fills omitted blocks from `site_configuration_get`. The first manual update flips the site to `manual_changes=true` server-side, after which FastPanel stops auto-managing the 443 block, HTTP→HTTPS redirect, and LE renewal locations. Bad syntax can take down the site or the whole nginx/apache service — and the tool does not run `nginx -t`.

## Adding a tool

1. Add a `server.tool(...)` block in `tools.ts` (read tools near the top, write tools below the divider comment).
2. Reads call `client.get()`; writes call `client.post/put/patch/delete()`, take `confirm`+`dry_run`, and go through `writeGuard()`.
3. Encode any non-obvious API behavior in the tool's `description` string — that text is the LLM's only documentation at runtime.
4. Keep the `README.md` tool tables and the tool count (currently 29) in sync.
5. `pnpm build && pnpm typecheck`, then smoke-test against a panel if it's a read tool.

## Project conventions

- ESM throughout (`"type": "module"`); intra-`src` imports use `.js` extensions (e.g. `./config.js`) because output is ESM.
- `sites_list` defaults to `compact:true` — the full site object is ~3KB and overflows context on large panels. Preserve compact-by-default for any list tool that returns large objects.
- No delete tools exist yet, by design — destructive ops are left to the UI until deliberately added.
