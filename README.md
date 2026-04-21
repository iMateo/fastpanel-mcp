# fastpanel-mcp

An [MCP](https://modelcontextprotocol.io/) server for [FastPanel 2](https://fastpanel.direct/) — expose site, database, DNS, user, certificate and queue management to LLM clients (Claude Code, Claude Desktop, Cursor, etc.) through the Model Context Protocol.

Lets you ask an LLM things like:

> *"What sites are running on this server and how much disk does each use?"*
>
> *"Create a new site `foo.example.com` under user `bar`, with a MySQL database, and attach our existing wildcard SSL cert."*
>
> *"Any failed background tasks in the FastPanel queue in the last hour?"*

> **Status:** alpha, unofficial, not affiliated with FastPanel. API endpoints and payload shapes were reverse-engineered from the panel's Angular SPA — they may change between FastPanel releases.

## Features

- 12 read tools (sites, databases, users, DNS zones & records, certificates, system load, task queue, raw nginx/apache/php.ini configs)
- 7 write tools (create user / database / site / LE certificate, attach existing SSL, update site backend, replace nginx/apache/php.ini configs)
- Dual-token model: separate read-only and write tokens; write operations fail-closed if no write token is provided
- Every write tool requires explicit `confirm: true`, and supports `dry_run: true` for previewing payloads
- Compact response mode to avoid overflowing LLM context on large sites lists
- Passwords redacted in dry-run output and stderr logs

## Requirements

- Node.js 20 or newer
- A FastPanel 2 installation you can reach over HTTPS
- At least one FastPanel API token (see below)

## Install

```bash
git clone https://github.com/<you>/fastpanel-mcp.git
cd fastpanel-mcp
pnpm install      # or: npm install
pnpm build
```

## Get API tokens

On the FastPanel host (needs root), create a read-only token:

```bash
fastpanel users tokens add -n mcp-read -s read_only -e 2026-12-31
```

That prints a JSON blob — copy the `msg` field; that's your token.

For write operations, create a second full-access token. Lock it to your IP and give it a short expiry:

```bash
fastpanel users tokens add -n mcp-write -c <your-ip> -e 2026-05-31
```

Tokens survive session TTLs and bypass the panel's 2FA — treat them as server credentials.

## Configure

```bash
cp .env.example .env
# fill in FASTPANEL_URL, FASTPANEL_TOKEN
# leave FASTPANEL_WRITE_TOKEN unset unless you actively need writes
```

## Use with Claude Code

```bash
claude mcp add fastpanel \
  -s user \
  -e "FASTPANEL_URL=https://panel.example.com:8888" \
  -e "FASTPANEL_TOKEN=<your read token>" \
  -e "FASTPANEL_INSECURE_TLS=1" \
  -- node $PWD/dist/index.js
```

For Claude Desktop / other MCP clients, point them at `node /absolute/path/to/dist/index.js` with the same env vars. Example `claude_desktop_config.json`:

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

## Debug locally

MCP Inspector gives you a GUI to poke at each tool:

```bash
pnpm inspect
```

Or drive JSON-RPC over stdio with the included smoke script:

```bash
FASTPANEL_URL=… FASTPANEL_TOKEN=… node scripts/smoke.mjs
```

## Tools

### Read

| Tool | Endpoint | Returns |
|---|---|---|
| `sites_list` | `GET /api/sites/list` | All websites (compact mode by default — 13 fields per site) |
| `site_get` | `GET /api/sites/{id}` | Full 40-field site object (cert, backend, backups, stats) |
| `databases_list` | `GET /api/databases` | MySQL + PostgreSQL databases with owners and sizes |
| `database_servers_list` | `GET /api/databases/servers` | Available DB servers (use ids in `database_create`) |
| `users_list` | `GET /api/users` | Panel users / site owners |
| `dns_domains_list` | `GET /api/dns/domains` | DNS zones |
| `dns_records_list` | `GET /api/dns/domain/{id}/records` | Records for a zone |
| `certificates_list` | `GET /api/certificates` | All stored SSL certs (LE + custom) |
| `site_configuration_get` | `GET /api/sites/{id}/configuration` | Raw nginx (frontend), apache (backend) and php.ini for the site |
| `system_load` | `GET /api/loads/full` | CPU / memory / disk / load averages / top processes |
| `queue_list` | `GET /api/queue/list` | Background tasks including completed |
| `queue_active` | `GET /api/queue` | Only in-flight tasks — use to poll async ops |

### Write

All write tools require `confirm: true`. Pass `dry_run: true` first to see the exact payload without touching the server.

| Tool | Endpoint | Purpose |
|---|---|---|
| `user_create` | `POST /api/users` | Create a new panel user / site owner |
| `database_create` | `POST /api/databases` | Create MySQL or PostgreSQL database + DB user |
| `site_create` | `POST /api/master/domain` + `PUT /api/master` | Create a site with optional inline user / DB / FTP |
| `site_ssl_update` | `PUT /api/sites/{id}` | Attach / detach an SSL cert, toggle HTTPS flags |
| `site_backend_update` | `PUT /api/sites/backend/{id}` | Change PHP version, handler, port, socket |
| `site_configuration_update` | `PUT /api/sites/{id}/configuration` | Replace nginx/apache/php.ini config. ⚠ bad syntax can break the site |
| `certificate_create_letsencrypt` | `POST /api/certificates` | Issue a new LE certificate for a site (async — poll `queue_active`) |

## Typical flows

**List everything that's running:**

```
sites_list → databases_list → system_load
```

**Provision a new test site with an existing wildcard certificate:**

```
site_create(domain="foo.example.com", owner_id=2, php_version="84", database={...})
  → site_ssl_update(site_id=<new>, certificate_id=<wildcard>)
```

**Provision a production site with a fresh Let's Encrypt cert:**

```
site_create(...)
  → certificate_create_letsencrypt(site_id=<new>, email, common_name)
  → queue_active  # poll until LE job reaches SUCCESS
```

**Harden the default nginx config (block `.git`, `.env`, `.htaccess`, etc.):**

```
site_configuration_get(site_id)
  # LLM inserts security location blocks into frontend
site_configuration_update(site_id, frontend=<edited>, backend=<unchanged>, phpini=<unchanged>)
```

## Safety model

- Write token is optional — if `FASTPANEL_WRITE_TOKEN` isn't set, every write tool errors out before hitting the network.
- `confirm: true` is required on every write. Tools refuse to execute without it.
- `dry_run: true` returns the exact JSON body that would be sent, with passwords redacted (`***`), and skips the HTTP call entirely.
- All executed write calls are logged to stderr with a redacted payload — visible in Claude Code's MCP logs.
- There are no delete tools yet; destructive operations are left to the UI until they're deliberately added.

## Known gotchas

- **`filter[...]` params:** FastPanel list endpoints (`/api/sites/list`, `/api/queue/list`) expect params wrapped as `filter[limit]=…&filter[type]=…`. Bare `?limit=…` is silently ignored.
- **Site creation is a wizard, not a REST create:** the panel does `POST /api/master/domain` (domain probe) then `PUT /api/master` (actual create), not `POST /api/sites`. `site_create` hides this from you.
- **Async operations:** certificate issuance, site backend updates, and some other ops return `action: "CREATING"` / `"UPDATING"` immediately and run in the background. Use `queue_active` to poll.
- **No official OpenAPI spec:** endpoints were reverse-engineered from the SPA bundle and DevTools traces. If a new FastPanel release breaks something, please file an issue with the new payload shape.
- **Self-signed TLS:** most panel installs use self-signed certs. Set `FASTPANEL_INSECURE_TLS=1` or put a proper cert in front.

## Roadmap

- Delete tools (`user_delete`, `site_delete`, `database_delete`, `certificate_delete`)
- DNS record CRUD
- Backup plan management (list / run / restore)
- CLI-fallback tools over SSH for operations not exposed via REST (`transfer`, `firewall save/restore`, `panel ip_match`)
- Structured MCP `outputSchema` so clients can render typed results
- Rate-limit aware retry with exponential backoff

## Contributing

Issues and PRs welcome, especially:

- Captured Network payloads for actions not yet covered
- Compatibility fixes for newer FastPanel versions
- Additional DB servers / runtime types in the enum schemas

## License

MIT — see [LICENSE](./LICENSE).

## Disclaimer

This is a third-party project. "FastPanel" is a trademark of its respective owners and this project is not affiliated with, endorsed by, or sponsored by FastPanel. Use at your own risk; test against a non-production FastPanel instance before pointing it at anything you care about.
