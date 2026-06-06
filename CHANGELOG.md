# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-06-06

Reliability, docroot/config tooling, host-level diagnostics, and an optional SSH layer.
**29 tools** total (up from 12).

### Added

- **Optional SSH layer** (`ssh.ts`) — opt-in via `FASTPANEL_SSH_HOST`, host-agnostic
  (host/user/port/key all from `FASTPANEL_SSH_*`). Shells out to the operator's own
  `ssh` client; no library dependency.
- **`site_update`** — change a site's document root (`index_dir`), with a
  `framework: "laravel" | "symfony"` preset that points the docroot at `public/`.
- **`site_logs`** — tail nginx/apache access/error logs over REST
  (`GET /api/sites/{id}/log/{lines}/{type}`), no SSH required.
- **`nginx_validate`** (SSH) — run `nginx -t` on the host to validate config before/after edits.
- **`site_doctor`** (SSH) — structured diagnosis: docroot existence, ancestor `o+x`
  traversal (the 750 → 404 trap), FPM socket, backend service, `nginx -t`.
- **`database_dump`** / **`database_import`** (SSH) — `mysqldump`/`mysql` for a local
  MySQL database, confined to a staging dir (`FASTPANEL_DUMP_DIR`).
- **`site_resources`**, **`backup_plans_list`**, **`me`**, **`settings_get`** — read tools.
- Computed `crt_path` / `key_path` on `certificates_list`.

### Changed

- **`site_backend_update`** now takes a site id and resolves the backend id internally
  (`PUT /api/sites/backend/{backend_id}`) — fixes a guaranteed 404. Backend fields are
  optional and merged from the current config.
- **`site_configuration_update`** supports partial updates (omitted blocks are back-filled
  from the current config) and warns that the first manual edit flips `manual_changes=true`.
- **`queue_active`** filters finished tasks and adds `meta.all_done` for deterministic polling.
- `sites_list` compact mode confirmed to include `index_dir`.

### Fixed

- Unwrap the `{data: …}` envelope on `GET /api/sites/{id}` and `…/configuration` — several
  tools were reading fields off the wrong object.
- Hardened SSH dump/import per security review: path sandboxing (reject paths outside the
  staging dir and `..`), `writeGuard` on `database_dump`, fail-closed DB validation, and
  no remote-stderr leakage in errors.

## [0.1.0] - 2026-04-21

Initial alpha: 12 tools over the FastPanel 2 REST API (sites, databases, users, DNS,
certificates, system load, queue) with the dual-token + `dry_run`/`confirm` write-safety model.

[1.1.0]: https://github.com/iMateo/fastpanel-mcp/releases/tag/v1.1.0
[0.1.0]: https://github.com/iMateo/fastpanel-mcp/releases/tag/v0.1.0
