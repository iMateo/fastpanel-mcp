# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-11-12

Mailbox management with an optional local password store. **39 tools** total.

### Added

- **`email_domains_list`** / **`email_domain_dkim_get`** / **`mailboxes_list`** / **`mailbox_get`** —
  read email domains, their DKIM record and mailboxes (size, quota, redirects, aliases, flags).
- **`mailbox_create`** / **`mailbox_update`** — create mailboxes and change password, quota,
  redirects, aliases, enabled state. `mailbox_update` is partial: it reads the box and re-sends
  untouched fields.
- **`generate_password: true`** on both write tools — FastPanel exposes mailbox passwords through
  no supported API/CLI path, so the tool mints a strong password and returns it exactly once in
  the result (never in logs or dry-run previews).
- **Mailbox password store** (opt-in, `FASTPANEL_PASSWORD_STORE=keychain`, macOS) — every
  password set through `mailbox_create` / `mailbox_update` is also saved to the login Keychain;
  **`mailbox_password_get`** reads it back and `mailboxes_list` flags `password_stored` per box.
  The secret reaches `security` over stdin, never argv.

## [1.2.0] - 2026-07-26

Security-review hardening and file-deployment tooling. **32 tools** total.

### Added

- **MCP tool annotations** on every tool (`readOnlyHint` / `destructiveHint` /
  `idempotentHint` / `openWorldHint`). Read-only diagnostics like `nginx_validate` and
  `site_doctor` are now correctly advertised as non-destructive, so MCP clients and external
  policy scanners stop lumping them in with mutating tools.
- **`site_configuration_update` auto-validation** — when SSH is configured, the tool runs
  `nginx -t` immediately after applying and **auto-reverts to the previous config** if the
  new one fails, so a bad edit can no longer leave nginx unable to reload. Opt out with
  `validate: false`. Without SSH the behaviour is unchanged (no validation).
- **`site_files_upload`** / **`site_files_deploy`** / **`site_file_put`** (SSH) — push files
  into a site's web root (rsync / git-or-tarball / inline), then `chown` to the site's owner
  so nginx/PHP-FPM can serve them. Reject destination paths that escape `index_dir` or contain
  shell-unsafe characters.

### Changed

- `site_configuration_update` now always snapshots the current config before writing (used both
  to back-fill omitted blocks and as the auto-revert target).

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

[1.2.0]: https://github.com/iMateo/fastpanel-mcp/releases/tag/v1.2.0
[1.1.0]: https://github.com/iMateo/fastpanel-mcp/releases/tag/v1.1.0
[0.1.0]: https://github.com/iMateo/fastpanel-mcp/releases/tag/v0.1.0
