# fastpanel-mcp

> Talk to your [FastPanel 2](https://fastpanel.direct/) server from Claude, Cursor, or any MCP-compatible client. Create sites, provision databases, attach SSL, harden nginx configs — through natural language, with production-grade safety rails.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io/)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)]()

**Keywords:** FastPanel, MCP, Model Context Protocol, Claude Code, Claude Desktop, server management, hosting automation, nginx, Let's Encrypt, DevOps, LLM ops, AI sysadmin.

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

- **21 tools** covering sites, databases, users, DNS zones, SSL certificates, system load, queue, site logs, and raw nginx/apache/php.ini configs.
- **Dual-token safety model.** Read operations use a read-only token; mutating operations require a separate write token (`FASTPANEL_WRITE_TOKEN`). Unset the write token and every write tool fails closed.
- **`confirm: true` required** on every write. Accidental LLM outputs cannot mutate state.
- **`dry_run: true` previews** the exact HTTP body the server would receive — passwords redacted as `***`, no network call fired.
- **Compact response mode** on sites_list to avoid overflowing LLM context on large panels.
- **stderr audit log** for every executed write, with passwords redacted.
- **Tested against a live FastPanel 2 panel** with 38 sites in production.

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
git clone https://github.com/<you>/fastpanel-mcp.git
cd fastpanel-mcp
pnpm install      # or: npm install
pnpm build
```

## Get API tokens

On the FastPanel host, create a read-only token for day-to-day use:

```bash
fastpanel users tokens add -n mcp-read -s read_only -e 2026-12-31
```

Copy the `msg` field from the returned JSON — that's your token. It bypasses 2FA and survives session TTLs, so treat it as a server credential.

Optional write token, with short expiry and IP lock:

```bash
fastpanel users tokens add -n mcp-write -c <your-ip> -e 2026-05-31
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

### Write (require `FASTPANEL_WRITE_TOKEN` + explicit `confirm: true`)

| Tool | Endpoint | Purpose |
|---|---|---|
| `user_create` | `POST /api/users` | Create a new panel user (site owner) |
| `database_create` | `POST /api/databases` | Create MySQL or PostgreSQL database with a dedicated DB user |
| `site_create` | `POST /api/master/domain` + `PUT /api/master` | Create a site atomically, optionally with inline user / database / FTP |
| `site_update` | `PUT /api/sites/{id}` | Change document root (`index_dir`) / directory index — e.g. point a Laravel site at `public/` (`framework: "laravel"` preset) |
| `site_ssl_update` | `PUT /api/sites/{id}` | Attach / replace / detach an SSL certificate, toggle HTTPS / HTTP2 / HTTP3 / HSTS |
| `site_backend_update` | `PUT /api/sites/backend/{backend_id}` | Change PHP version, handler, port, socket, env vars (pass site id — backend id resolved internally) |
| `site_configuration_update` | `PUT /api/sites/{id}/configuration` | Replace raw nginx/apache/php.ini for the site. **Dangerous**: bad syntax can break the site |
| `certificate_create_letsencrypt` | `POST /api/certificates` | Issue a new Let's Encrypt certificate (async — poll `queue_active`) |

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
- **No delete tools** yet. Destructive operations are left to the UI until they're deliberately added.
- **IP-lock tokens** (`fastpanel users tokens add -c <ip>`) so a leaked token can't be used from elsewhere.

## Known gotchas

- **`filter[...]` params:** FastPanel list endpoints expect `filter[limit]=…&filter[type]=…`. Bare `?limit=…` is silently ignored.
- **Site creation is a wizard, not a REST create.** The panel does `POST /api/master/domain` (probe) then `PUT /api/master` (actual create), not `POST /api/sites`. `site_create` hides this.
- **Async operations.** Cert issuance, site backend updates, and several other ops return `action: "CREATING"` / `"UPDATING"` immediately and run in the background. Use `queue_active` to poll.
- **No official OpenAPI spec.** Endpoints were reverse-engineered. If a new FastPanel release breaks something, please file an issue with the new payload shape.
- **Self-signed TLS.** Most panel installs use self-signed certs. Set `FASTPANEL_INSECURE_TLS=1` or put a proper cert in front.
- **fail2ban / rate limiting.** FastPanel ships with fail2ban and panel-level rate limiting. Test scripts that hammer the API may get your IP blocked.

## Roadmap

- Delete tools (`user_delete`, `site_delete`, `database_delete`, `certificate_delete`)
- DNS record CRUD
- Backup plan management (list / run / restore)
- Email domain + mailbox management
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
