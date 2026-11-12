# fastpanel-mcp

> Talk to your [FastPanel 2](https://fastpanel.direct/) server from Claude, Cursor, or any MCP-compatible client. Create sites, provision databases, attach SSL, harden nginx configs — through natural language, with production-grade safety rails.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io/)
[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](./CHANGELOG.md)

**Keywords:** FastPanel, MCP, Model Context Protocol, Claude Code, Claude Desktop, server management, hosting automation, nginx, Let's Encrypt, DevOps, LLM ops, AI sysadmin.

**Read this in other languages:** [English](./README.md) · [Русский](./README.ru.md) · [Українська](./README.uk.md) · [Español](./README.es.md) · [Deutsch](./README.de.md)

---

## What you get

Ask an LLM, get real infra changes on your FastPanel server:

> **You:** "Create a new site `foo.example.com` under user `www-root`, PHP 8.4, no database, and attach our wildcard SSL cert. Also enable HTTP/2 and HTTP/3."
>
> **LLM (~30 seconds, 5 tool calls later):** Site id 53 is live at https://foo.example.com with HTTP/2, HTTP/3, wildcard TLS, and an auto-provisioned HTTPS redirect.

> **You:** "Show me the nginx config for site 1 — check if it blocks `.env`, `.git`, and other sensitive paths. If not, add hardening."
>
> **LLM:** Reads the config, notes that `.env` and `.htaccess` are served as static files (security gap), edits the frontend to add deny rules for dotfiles + sensitive extensions + framework files, previews the diff via `dry_run`, then deploys it. `.env` now returns 404; `.well-known/acme-challenge` still works.

> **You:** "What sites are running on this server, who owns them, and which ones don't force HTTPS?"
>
> **LLM:** Queries `sites_list` and reports the 5 sites without `https_redirect: true`.

## Features

- **39 tools** covering sites, email domains & mailboxes, databases (incl. SSH dump/import), users, DNS zones, SSL certificates, system load, queue, site logs, backup plans, host-level diagnostics, file upload/deploy into a site's web root, and raw nginx/apache/php.ini configs.
- **Dual-token safety model.** Read operations use a read-only token; mutating operations require a separate write token (`FASTPANEL_WRITE_TOKEN`). Unset the write token and every write tool fails closed.
- **`confirm: true` required** on every write. Accidental LLM outputs cannot mutate state.
- **`dry_run: true` previews** the exact HTTP body the server would receive — passwords redacted as `***`, no network call fired.
- **Compact response mode** on sites_list to avoid overflowing LLM context on large panels.
- **stderr audit log** for every executed write, with passwords redacted.
- **MCP tool annotations** (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`) so clients and policy scanners classify each tool correctly instead of treating read-only diagnostics as destructive.
- **`nginx -t` auto-validation with rollback** — `site_configuration_update` validates the live config after applying and reverts a broken edit automatically when SSH is configured.
- **Tested against a live FastPanel 2 panel** with 35+ sites in production.

## Why this exists

FastPanel publishes no OpenAPI spec. The endpoints and payload shapes in this server were reverse-engineered from the panel's Angular SPA bundle and live DevTools captures, including non-obvious quirks like:

- List endpoints require `filter[limit]=…&filter[type]=…` wrapped params — bare `?limit=…` is silently ignored.
- Site creation is a two-step wizard (`POST /api/master/domain` probe → `PUT /api/master`), not a conventional `POST /api/sites`.
- The `backend` field in site configuration is PHP-FPM pool config when `handler=php_fpm`, but an Apache VirtualHost block when `handler=fcgi`.
- SSL attach/detach flows through `PUT /api/sites/{id}` (site-side) not `POST /api/sites/{id}/certificate` (there is no such endpoint).

These are documented in the tool descriptions so the LLM doesn't have to rediscover them.

## Requirements

- Node.js 20 or newer
- A FastPanel 2 installation reachable over HTTPS
- Root SSH on the panel host to create API tokens (one-time)

## Install

```bash
git clone https://github.com/iMateo/fastpanel-mcp.git
cd fastpanel-mcp
pnpm install      # or: npm install
pnpm build
```

## Get API tokens

On the FastPanel host (as root), create a read-only token for day-to-day use:

```bash
mogwai users tokens add -n mcp-read -s read_only -e 2030-12-31
```

> The CLI binary is `/usr/local/fastpanel2/fastpanel`; recent FastPanel builds expose it on `PATH` as `mogwai` (`/usr/local/bin/mogwai` → the same binary). Older docs call it `fastpanel`, which is **not** on `PATH` — use `mogwai`, or the full path. Root only.

Copy the `msg` field from the returned JSON — that's your token. It bypasses 2FA and survives session TTLs, so treat it as a server credential.

Optional write token, with an expiry and IP lock:

```bash
mogwai users tokens add -n mcp-write -c <your-ip> -e 2030-12-31
```

Leave `FASTPANEL_WRITE_TOKEN` unset in configs where you don't need writes.

## Configure

```bash
cp .env.example .env
```

Minimum viable `.env`:

```
FASTPANEL_URL=https://panel.example.com:8888
FASTPANEL_TOKEN=<your read token>
FASTPANEL_INSECURE_TLS=1   # only if panel uses self-signed cert
```

## Use with Claude Code

```bash
claude mcp add fastpanel \
  -s user \
  -e "FASTPANEL_URL=https://panel.example.com:8888" \
  -e "FASTPANEL_TOKEN=…" \
  -e "FASTPANEL_INSECURE_TLS=1" \
  -- node $PWD/dist/index.js
```

Add `-e "FASTPANEL_WRITE_TOKEN=…"` when you want write tools enabled.

## Use with Claude Desktop / Cursor / other MCP clients

`claude_desktop_config.json` (or equivalent):

```json
{
  "mcpServers": {
    "fastpanel": {
      "command": "node",
      "args": ["/absolute/path/to/fastpanel-mcp/dist/index.js"],
      "env": {
        "FASTPANEL_URL": "https://panel.example.com:8888",
        "FASTPANEL_TOKEN": "…",
        "FASTPANEL_INSECURE_TLS": "1"
      }
    }
  }
}
```

## Debug

Inspect tools with the MCP Inspector GUI:

```bash
pnpm inspect
```

Drive JSON-RPC over stdio manually:

```bash
FASTPANEL_URL=… FASTPANEL_TOKEN=… node scripts/smoke.mjs
```

## Tools

### Read (no write token required)

| Tool | Endpoint | Returns |
|---|---|---|
| `sites_list` | `GET /api/sites/list` | All websites, 13 essential fields by default (compact mode) |
| `site_get` | `GET /api/sites/{id}` | Full 40-field site object (cert, backend, backups, stats) |
| `site_configuration_get` | `GET /api/sites/{id}/configuration` | Raw nginx (frontend), handler backend (PHP-FPM or Apache), php.ini |
| `databases_list` | `GET /api/databases` | MySQL + PostgreSQL databases with owners and sizes |
| `database_servers_list` | `GET /api/databases/servers` | Available DB servers — use ids in `database_create` |
| `users_list` | `GET /api/users` | Panel users and site owners |
| `dns_domains_list` | `GET /api/dns/domains` | DNS zones (empty if panel DNS is off) |
| `dns_records_list` | `GET /api/dns/domain/{id}/records` | Records for one zone |
| `certificates_list` | `GET /api/certificates` | Stored SSL certificates (LE + custom) |
| `system_load` | `GET /api/loads/full` | CPU / memory / disk / load averages / top processes |
| `queue_list` | `GET /api/queue/list` | Background tasks including completed |
| `queue_active` | `GET /api/queue` | In-flight tasks only (filters finished) + `meta.all_done` for deterministic polling |
| `site_logs` | `GET /api/sites/{id}/log/{lines}/{type}` | Tail nginx/apache access or error log (frontend_/backend_) without SSH |
| `site_resources` | `GET /api/sites/{id}/resources` | Databases, sub-domains, DNS & email zones attached to a site |
| `backup_plans_list` | `GET /api/v2/backup/plans` | Configured backup plans |
| `me` | `GET /api/me` | Account behind the current read token (username, roles, ssh) |
| `settings_get` | `GET /api/settings` | Panel-wide settings (OS, license, limits, notifications) |
| `email_domains_list` | `GET /api/email/domains` | List email domains (optionally for one site); ids feed the mailbox tools |
| `email_domain_dkim_get` | `GET /api/email/domains/{id}/dkim` | DKIM DNS record (TXT with public key) for an email domain |
| `mailboxes_list` | `GET /api/email/domains/{id}/boxs` | Mailboxes of a domain: size, quota, redirects, aliases, flags (compact by default) |
| `mailbox_get` | `GET /api/mail/box/{id}` | One mailbox, full object. Passwords are never returned — FastPanel exposes no path to read one |
| `mailbox_password_get` | macOS Keychain | Password of a mailbox from the **local** password store (macOS Keychain). Opt-in via `FASTPANEL_PASSWORD_STORE=keychain`; only knows passwords set through this MCP |

### Write (require `FASTPANEL_WRITE_TOKEN` + explicit `confirm: true`)

| Tool | Endpoint | Purpose |
|---|---|---|
| `user_create` | `POST /api/users` | Create a new panel user (site owner) |
| `database_create` | `POST /api/databases` | Create MySQL or PostgreSQL database with a dedicated DB user |
| `site_create` | `POST /api/master/domain` + `PUT /api/master` | Create a site atomically, optionally with inline user / database / FTP |
| `site_update` | `PUT /api/sites/{id}` | Change document root (`index_dir`) / directory index — e.g. point a Laravel site at `public/` (`framework: "laravel"` preset) |
| `site_ssl_update` | `PUT /api/sites/{id}` | Attach / replace / detach an SSL certificate, toggle HTTPS / HTTP2 / HTTP3 / HSTS |
| `site_backend_update` | `PUT /api/sites/backend/{backend_id}` | Change PHP version, handler, port, socket, env vars (pass site id — backend id resolved internally) |
| `site_configuration_update` | `PUT /api/sites/{id}/configuration` | Replace raw nginx/apache/php.ini for the site. **Dangerous**: bad syntax can break the site — when SSH is configured, runs `nginx -t` after applying and **auto-reverts** on failure (`validate: false` to skip) |
| `certificate_create_letsencrypt` | `POST /api/certificates` | Issue a new Let's Encrypt certificate (async — poll `queue_active`) |
| `mailbox_create` | `POST /api/email/domains/{id}/boxs` | Create a mailbox with redirects / aliases / quota. `generate_password: true` mints a strong password and returns it **once** |
| `mailbox_update` | `PUT /api/mail/box/{id}` | Reset password (optionally generated, returned once), enable/disable, change quota / redirects / aliases — only the fields you pass change |

### Mailbox password store (optional)

FastPanel exposes no way to read a mailbox password back — no API or CLI returns one (internally it keeps a one-way IMAP hash plus a reversible copy only the panel process itself can decrypt, for its own Roundcube autologin). So handing an existing technical mailbox to a new client normally means resetting its password and breaking everything else that uses it. Set `FASTPANEL_PASSWORD_STORE=keychain` (macOS only) and every password set through `mailbox_create` / `mailbox_update` — generated or explicit — is also saved to your login Keychain (service `fastpanel-mcp:<panel host>`, account = mailbox address; visible in Keychain Access). `mailbox_password_get` reads it back and `mailboxes_list` marks each box with `password_stored`.

Passwords set before the store was enabled, or changed later in the panel UI, are not known to it. The secret is passed to `security` over stdin, never in argv, and never logged. Trade-off: anything running as your macOS user can read these entries, and `mailbox_password_get` puts a plaintext credential into the model's context — leave the store off if that is not acceptable.


### SSH-backed (require `FASTPANEL_SSH_HOST`)

These do what the REST API can't — they run on the panel host itself. Opt-in and host-agnostic: set `FASTPANEL_SSH_HOST` (+ optional `FASTPANEL_SSH_USER`/`PORT`/`KEY`) to point at **any** FastPanel server. The server shells out to your own `ssh` client, so the host just needs to be reachable with key-based auth. `nginx_validate` and `site_doctor` are read-only; the rest are writes (`confirm: true` + `dry_run` preview).

| Tool | Runs | Purpose |
|---|---|---|
| `nginx_validate` | `nginx -t` | Validate the live nginx config before/after `site_configuration_update` — catch syntax errors before they take nginx down |
| `site_doctor` | `stat` / `systemctl` / `nginx -t` | Diagnose why a site errors: missing docroot, a parent dir without `o+x` (the 750 → 404 trap), missing FPM socket, dead backend, broken nginx config |
| `database_dump` | `mysqldump` | Dump a database to a `.sql` file in the staging dir (local MySQL). Writes a root-owned file — needs `confirm: true` |
| `database_import` | `mysql` | Load a `.sql` file (from the staging dir) into a database. **Destructive** — needs `confirm: true` |
| `site_files_upload` | `rsync` (scp fallback) | Upload a local file/dir into a site's web root, then chown to the site user. `delete: true` mirrors (removes remote-only files) |
| `site_files_deploy` | `git clone` / `curl` + `tar` | Fetch files on the host (https git repo or tarball) into a site's web root, then chown to the site user |
| `site_file_put` | `cat` over ssh | Write one small inline file (placeholder/.htaccess/robots.txt) into a site's web root, then chown to the site user |

Dump/import paths are confined to a staging dir (default `/root/fastpanel-mcp-dumps`, override with `FASTPANEL_DUMP_DIR`); paths outside it or containing `..` are rejected. The three upload/deploy tools resolve the site's `index_dir` + owner via `site_get`, refuse destination subpaths that escape the web root or contain shell-unsafe characters, and `chown` everything to the site's system user so nginx/PHP-FPM can serve it (root-owned files would 403).

## Cookbook

**Provision a new test site under a wildcard cert (30 seconds, no DNS/LE wait):**

```
site_create(domain="foo.example.com", owner_id=2, php_version="84")
  → site_ssl_update(site_id=<new>, certificate_id=<wildcard>, https_redirect=true, http2=true, http3=true)
```

**Provision a production site with a fresh Let's Encrypt cert:**

```
site_create(domain="foo.com", aliases=["www.foo.com"], owner_id=<id>, php_version="84", database={...})
  → certificate_create_letsencrypt(site_id=<new>, email, common_name="foo.com")
  → queue_active  # poll until LE job SUCCESS
```

**Harden default nginx (block `.git`, `.env`, `.htaccess`, composer.json, etc.):**

```
site_configuration_get(site_id)
  # LLM inserts security location blocks into frontend
site_configuration_update(site_id, frontend=<edited>, backend=<unchanged>, phpini=<unchanged>)
```

**Remove deprecated TLS versions:**

```
site_configuration_get(site_id)
  # LLM replaces "ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3" with "ssl_protocols TLSv1.2 TLSv1.3"
site_configuration_update(site_id, frontend=<edited>, backend=<unchanged>, phpini=<unchanged>)
```

## Safety model

- **Dual tokens.** Read token always required. Write token is optional — if `FASTPANEL_WRITE_TOKEN` isn't set, every write tool errors out before touching the network with `FastPanelWriteDisabledError`.
- **`confirm: true`** is a required argument on every write tool. Tools refuse to execute without it — this is your last line of defence against a confused LLM.
- **`dry_run: true`** returns the exact JSON body that would be sent, passwords redacted as `***`, and skips the HTTP call entirely.
- **stderr audit log** records every executed write with redacted payload. In Claude Code this surfaces in MCP logs.
- **`nginx -t` auto-validation.** With SSH configured, `site_configuration_update` runs `nginx -t` right after applying and **auto-reverts to the previous config** if it fails — a bad edit can't leave nginx unable to reload. Pass `validate: false` to opt out.
- **Tool annotations.** Every tool ships MCP `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` hints so MCP clients and external policy gateways can apply the right guardrails per tool.
- **No delete tools** yet — including mailbox delete/purge. Destructive operations stay in the UI for now; they are planned for later, once the MCP protocol itself offers stronger safety guarantees for irreversible actions.
- **IP-lock tokens** (`mogwai users tokens add -c <ip>`) so a leaked token can't be used from elsewhere.

## Known gotchas

- **`filter[...]` params:** FastPanel list endpoints expect `filter[limit]=…&filter[type]=…`. Bare `?limit=…` is silently ignored.
- **Site creation is a wizard, not a REST create.** The panel does `POST /api/master/domain` (probe) then `PUT /api/master` (actual create), not `POST /api/sites`. `site_create` hides this.
- **Async operations.** Cert issuance, site backend updates, and several other ops return `action: "CREATING"` / `"UPDATING"` immediately and run in the background. Use `queue_active` to poll.
- **No official OpenAPI spec.** Endpoints were reverse-engineered. If a new FastPanel release breaks something, please file an issue with the new payload shape.
- **Self-signed TLS.** Most panel installs use self-signed certs. Set `FASTPANEL_INSECURE_TLS=1` or put a proper cert in front.
- **fail2ban / rate limiting.** FastPanel ships with fail2ban and panel-level rate limiting. Test scripts that hammer the API may get your IP blocked.

## Roadmap

- Delete tools (`user_delete`, `site_delete`, `database_delete`, `certificate_delete`, mailbox delete/purge) — later, when MCP gets safer for irreversible operations
- DNS record CRUD
- Backup plan management (list / run / restore)
- Email domain create/update
- Bulk operations (e.g. "apply this nginx hardening to every site")
- CLI-fallback tools over SSH for ops not in REST (`transfer`, `firewall save/restore`, `panel ip_match`)
- Structured MCP `outputSchema` so clients can render typed results
- Rate-limit aware retry with exponential backoff

## Contributing

Issues and PRs welcome. Especially useful:

- Captured DevTools Network payloads for actions not yet covered
- Compatibility fixes for newer FastPanel versions
- Additional DB servers / runtime types in the enum schemas
- Screenshots / recordings of typical flows for the README

## Author

Built and maintained by **Ihor Chyshkala** — [chyshkala.com](https://chyshkala.com) · [ihor@chyshkala.com](mailto:ihor@chyshkala.com).

### Services

Available for hire via [chyshkala.com](https://chyshkala.com):

| Service | What it covers |
|---|---|
| **Web Development** | Full-stack web apps with React, Next.js & Node.js |
| **Process Automation** | Workflows, integrations & data pipelines |
| **API Development** | REST, GraphQL & third-party integrations |
| **AI Integration** | ChatGPT, Claude & custom AI solutions |
| **AI Chatbot** _(new)_ | Custom chatbots trained on your data |
| **DevOps** | CI/CD, Docker & cloud infrastructure |
| **CTO-as-a-Service** | Technical leadership for startups |
| **Due Diligence** | Technical audits for investors |
| **Legacy Modernization** | Migrate from legacy to modern stack |

## License

MIT — see [LICENSE](./LICENSE).

## Disclaimer

This is a third-party, community project. "FastPanel" is a trademark of its respective owners. This project is not affiliated with, endorsed by, or sponsored by FastPanel. Test against a non-production FastPanel instance before pointing it at anything you care about.
