import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FastPanelClient } from "./client.js";
import { FastPanelError } from "./client.js";

function asJsonText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function asError(err: unknown) {
  const msg =
    err instanceof FastPanelError
      ? `${err.message}\n\nResponse body:\n${JSON.stringify(err.body, null, 2)}`
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: msg }],
  };
}

function logWrite(op: string, payload: unknown): void {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] fastpanel-mcp write: ${op} ${JSON.stringify(payload)}\n`);
}

type WriteArgs = { confirm: boolean; dry_run: boolean };

function writeGuard(
  args: WriteArgs,
  operation: string,
  payload: unknown,
): { kind: "dry"; result: ReturnType<typeof asJsonText> } | { kind: "proceed" } {
  if (args.dry_run) {
    return {
      kind: "dry",
      result: asJsonText({
        dry_run: true,
        operation,
        payload,
        note: "This is a preview. Set dry_run:false and confirm:true to execute.",
      }),
    };
  }
  if (!args.confirm) {
    throw new Error(
      `Refusing to execute ${operation} without confirm:true. ` +
        `Set dry_run:true first to preview the payload, then confirm:true to execute.`,
    );
  }
  return { kind: "proceed" };
}

function redactPasswords(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactPasswords);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = /password|secret/i.test(k) ? "***" : redactPasswords(v);
  }
  return out;
}

export function registerTools(server: McpServer, client: FastPanelClient): void {
  // ──────────────────────────────────────────────────────────────────────────
  // READ TOOLS
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    "sites_list",
    "List all websites managed by FastPanel. Compact mode (default) returns only essential fields — full response is ~3KB per site and can overflow context. Use site_get(id) for full details of a specific site.",
    {
      limit: z.number().int().positive().max(10000).default(1000).describe("Max rows to return"),
      compact: z
        .boolean()
        .default(true)
        .describe(
          "If true, return only essential fields (id, domain, aliases, ips, owner, enabled, status, https_redirect, http2, size, databases_size, created_at). If false, returns all 40 fields per site.",
        ),
    },
    async ({ limit, compact }) => {
      try {
        const data = await client.get<{ data: Array<Record<string, unknown>> }>(
          "/api/sites/list",
          { "filter[limit]": limit, "filter[type]": "all" },
        );
        if (!compact) return asJsonText(data);

        const keep = [
          "id",
          "domain",
          "aliases",
          "ips",
          "owner",
          "enabled",
          "status",
          "https_redirect",
          "http2",
          "index_dir",
          "size",
          "databases_size",
          "created_at",
        ];
        const slim = data.data.map((site) => {
          const out: Record<string, unknown> = {};
          for (const k of keep) if (k in site) out[k] = site[k];
          return out;
        });
        return asJsonText({ data: slim, meta: { count: slim.length, compact: true } });
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "site_get",
    "Get full details for a single site by id. Returns all 40 fields including SSL certificate, backend config, permissions, backup plan, stats.",
    { site_id: z.number().int().positive().describe("Site id from sites_list") },
    async ({ site_id }) => {
      try {
        const data = await client.get(`/api/sites/${site_id}`);
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "databases_list",
    "List all MySQL and PostgreSQL databases. Returns id, name, charset, size, owner, linked site, server, last dump timestamp.",
    {},
    async () => {
      try {
        const data = await client.get("/api/databases");
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "database_servers_list",
    "List available database servers (MySQL, PostgreSQL). Use the returned ids as server_id in database_create and site_create.",
    {},
    async () => {
      try {
        const data = await client.get("/api/databases/servers");
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "users_list",
    "List all FastPanel system users (site owners). Returns id, username, home_dir, roles, PHP version, quota, ssh_access, enabled flag.",
    {},
    async () => {
      try {
        const data = await client.get("/api/users");
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "dns_domains_list",
    "List all DNS zones managed by FastPanel's DNS service. Empty if DNS is not configured.",
    {},
    async () => {
      try {
        const data = await client.get("/api/dns/domains");
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "dns_records_list",
    "List all DNS records for a specific domain (zone) by its id. Use dns_domains_list first to get ids.",
    { domain_id: z.number().int().positive().describe("DNS zone id from dns_domains_list") },
    async ({ domain_id }) => {
      try {
        const data = await client.get(`/api/dns/domain/${domain_id}/records`);
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "certificates_list",
    "List all SSL certificates stored in FastPanel (Let's Encrypt and custom). Returns id, name, type, common_name, alternative_name, expiration, linked site.",
    {},
    async () => {
      try {
        const data = await client.get("/api/certificates");
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "system_load",
    "Get current server load metrics — CPU, memory, disk, uptime. Source: FastPanel's internal /api/loads/full endpoint.",
    {},
    async () => {
      try {
        const data = await client.get("/api/loads/full");
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "queue_list",
    "List active and recent FastPanel background tasks (backups, migrations, SSL issuance, screenshots, etc) including completed ones.",
    { limit: z.number().int().positive().max(1000).default(100).describe("Max rows to return") },
    async ({ limit }) => {
      try {
        const data = await client.get("/api/queue/list", { "filter[limit]": limit });
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "queue_active",
    "List only currently active (in-flight) FastPanel background tasks. Use this to poll progress after firing async operations like certificate_create_letsencrypt. Empty array means all jobs completed.",
    {},
    async () => {
      try {
        const data = await client.get("/api/queue");
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // WRITE TOOLS — each requires confirm:true, supports dry_run:true
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    "user_create",
    "Create a new FastPanel system user (site owner). This is a WRITE operation — set dry_run:true to preview, confirm:true to execute.",
    {
      username: z.string().min(1).max(64).describe("Unix-safe username, e.g. 'mycompany'"),
      password: z.string().min(8).describe("User password (min 8 chars)"),
      roles: z
        .enum(["ROLE_USER", "ROLE_RESELLER"])
        .default("ROLE_USER")
        .describe("ROLE_USER = owns own sites; ROLE_RESELLER = can manage sub-users"),
      quota: z
        .number()
        .int()
        .nonnegative()
        .default(0)
        .describe("Disk quota in KB, 0 = unlimited"),
      confirm: z.boolean().default(false).describe("Must be true to execute. Safety guard."),
      dry_run: z
        .boolean()
        .default(false)
        .describe("If true, show the payload that would be sent without executing."),
    },
    async ({ username, password, roles, quota, confirm, dry_run }) => {
      try {
        const payload = { username, password, roles, quota };
        const g = writeGuard({ confirm, dry_run }, "POST /api/users", redactPasswords(payload));
        if (g.kind === "dry") return g.result;
        logWrite("POST /api/users", redactPasswords(payload));
        const data = await client.post("/api/users", payload);
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "database_create",
    "Create a new database (MySQL or PostgreSQL) with a dedicated DB user. WRITE operation — set dry_run:true to preview, confirm:true to execute.",
    {
      name: z
        .string()
        .min(1)
        .max(64)
        .describe("Database name (MySQL: a-z0-9_, max 64; Postgres: also allows more)"),
      charset: z
        .string()
        .default("utf8")
        .describe("Charset: 'utf8' or 'utf8mb4' for MySQL, 'en_US.UTF-8' for PostgreSQL"),
      server_id: z
        .number()
        .int()
        .positive()
        .describe("DB server id from database_servers_list (1=MySQL, 2=PostgreSQL typically)"),
      owner_id: z.number().int().positive().describe("FastPanel user id (owner) from users_list"),
      site_id: z
        .number()
        .int()
        .positive()
        .nullable()
        .default(null)
        .describe("Link DB to a site (optional). Null = standalone DB."),
      db_user_login: z.string().min(1).describe("DB user login (the user that owns this DB)"),
      db_user_password: z.string().min(8).describe("DB user password (min 8 chars)"),
      confirm: z.boolean().default(false),
      dry_run: z.boolean().default(false),
    },
    async ({
      name,
      charset,
      server_id,
      owner_id,
      site_id,
      db_user_login,
      db_user_password,
      confirm,
      dry_run,
    }) => {
      try {
        const payload = {
          charset,
          name,
          owner_id,
          server_id,
          site: site_id,
          user: { login: db_user_login, password: db_user_password },
        };
        const g = writeGuard(
          { confirm, dry_run },
          "POST /api/databases",
          redactPasswords(payload),
        );
        if (g.kind === "dry") return g.result;
        logWrite("POST /api/databases", redactPasswords(payload));
        const data = await client.post("/api/databases", payload);
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "site_ssl_update",
    "Attach, replace, or detach an SSL certificate on an existing site, and toggle HTTPS flags. Maps to PUT /api/sites/{site_id}. Use for wildcard flow: create site in *.icstudio.space, then attach an existing wildcard cert. Pass certificate_id=null to detach. WRITE — confirm:true required.",
    {
      site_id: z.number().int().positive().describe("Site id from sites_list"),
      certificate_id: z
        .number()
        .int()
        .positive()
        .nullable()
        .describe("Existing cert id from certificates_list, or null to detach current cert"),
      https_redirect: z.boolean().optional().describe("Force HTTP → HTTPS redirect"),
      hsts: z.boolean().optional().describe("Enable HTTP Strict Transport Security"),
      http2: z.boolean().optional().describe("Enable HTTP/2"),
      http3: z.boolean().optional().describe("Enable HTTP/3 / QUIC"),
      manual_changes: z
        .boolean()
        .default(false)
        .describe("Preserve manual nginx edits. Usually false when panel manages config."),
      confirm: z.boolean().default(false),
      dry_run: z.boolean().default(false),
    },
    async ({ site_id, confirm, dry_run, ...fields }) => {
      try {
        // Only include fields that were actually passed (support partial update).
        const payload: Record<string, unknown> = { manual_changes: fields.manual_changes };
        payload.certificate = fields.certificate_id;
        if (fields.https_redirect !== undefined) payload.https_redirect = fields.https_redirect;
        if (fields.hsts !== undefined) payload.hsts = fields.hsts;
        if (fields.http2 !== undefined) payload.http2 = fields.http2;
        if (fields.http3 !== undefined) payload.http3 = fields.http3;

        const g = writeGuard({ confirm, dry_run }, `PUT /api/sites/${site_id}`, payload);
        if (g.kind === "dry") return g.result;
        logWrite(`PUT /api/sites/${site_id}`, payload);
        const data = await client.put(`/api/sites/${site_id}`, payload);
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "certificate_create_letsencrypt",
    "Issue a Let's Encrypt SSL certificate for an existing site. This is ASYNC — response returns immediately with status 'CREATING'. Poll queue_active to track issuance progress. REQUIREMENTS: site must be publicly accessible with correct DNS for HTTP-01 challenge to succeed. WRITE operation — confirm:true to execute.",
    {
      site_id: z.number().int().positive().describe("Site id from sites_list (maps to 'virtualhost' in API)"),
      email: z.string().email().describe("Contact email for Let's Encrypt registration"),
      common_name: z.string().min(1).describe("Primary domain for the certificate (CN)"),
      alternative_names: z
        .array(z.string().min(1))
        .default([])
        .describe("Additional SAN domains. If empty, will be set to [common_name]."),
      force_dns_validation: z
        .boolean()
        .default(false)
        .describe("Use DNS-01 challenge instead of HTTP-01 (required for wildcard certs)"),
      key_length: z
        .union([z.literal(2048), z.literal(4096)])
        .default(2048)
        .describe("RSA key length"),
      confirm: z.boolean().default(false),
      dry_run: z.boolean().default(false),
    },
    async ({
      site_id,
      email,
      common_name,
      alternative_names,
      force_dns_validation,
      key_length,
      confirm,
      dry_run,
    }) => {
      try {
        const sans = alternative_names.length > 0 ? alternative_names : [common_name];
        const payload = {
          type: "letsencrypt",
          email,
          common_name,
          alternative_name: sans.join(","),
          force_dns_validation,
          virtualhost: site_id,
          length: key_length,
        };
        const g = writeGuard({ confirm, dry_run }, "POST /api/certificates", payload);
        if (g.kind === "dry") return g.result;
        logWrite("POST /api/certificates", payload);
        const data = await client.post("/api/certificates", payload);
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "site_backend_update",
    "Update backend settings of an existing site: PHP version, handler (php_fpm/fcgi), app file, port, socket path, env vars. Maps to PUT /api/sites/backend/{site_id}. WRITE — confirm:true required. Use site_get(id) first to see current backend config.",
    {
      site_id: z.number().int().positive().describe("Site id from sites_list"),
      type: z.enum(["php", "nodejs", "python"]).default("php").describe("Backend runtime type"),
      handler: z.enum(["php_fpm", "fcgi"]).describe("PHP handler (only meaningful for type=php)"),
      handler_version: z
        .enum(["74", "80", "81", "82", "83", "84"])
        .describe("PHP version without dot"),
      app_file: z.string().default("index.php").describe("Entry file"),
      port: z.number().int().min(1024).max(65535).describe("Backend listen port"),
      socket_path: z.string().describe("Unix socket path for the backend"),
      index_dir: z.string().describe("Document root path, e.g. /var/www/<user>/data/www/<domain>"),
      manual_changes: z
        .boolean()
        .default(false)
        .describe("Preserve manual changes to backend config"),
      environment: z.array(z.string()).default([""]).describe("Env vars, e.g. ['KEY=val']"),
      work_dir: z.string().default("").describe("Working directory (optional)"),
      confirm: z.boolean().default(false),
      dry_run: z.boolean().default(false),
    },
    async ({ site_id, confirm, dry_run, ...rest }) => {
      try {
        const payload = rest;
        const g = writeGuard(
          { confirm, dry_run },
          `PUT /api/sites/backend/${site_id}`,
          payload,
        );
        if (g.kind === "dry") return g.result;
        logWrite(`PUT /api/sites/backend/${site_id}`, payload);
        const data = await client.put(`/api/sites/backend/${site_id}`, payload);
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );

  server.tool(
    "site_create",
    "Create a new website in FastPanel using the /api/master wizard endpoint. Can create owner/database/FTP inline atomically. Does NOT issue SSL — call certificate_create_letsencrypt after site is active. WRITE operation — set dry_run:true first, then confirm:true to execute. Flow: (1) POST /api/master/domain probes for existing email/DNS zones, (2) PUT /api/master creates the site with everything.",
    {
      domain: z.string().min(3).describe("Primary domain, e.g. 'example.com' or 'sub.example.com'"),
      aliases: z
        .array(z.string().min(3))
        .default([])
        .describe("Additional domain aliases, e.g. ['www.example.com']"),
      ips: z
        .array(z.string().min(7))
        .min(1)
        .describe("Server IPs to bind to, e.g. ['100.42.181.157']. Get from sites_list → ips field."),
      owner_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Existing FastPanel user id (from users_list). Use this OR new_owner, not both."),
      new_owner: z
        .object({
          username: z.string().min(1).max(64),
          password: z.string().min(8),
          quota: z.number().int().nonnegative().default(0),
        })
        .optional()
        .describe("Create a new user inline. Use this OR owner_id, not both. EXPERIMENTAL — not yet tested against live API."),
      php_version: z
        .enum(["74", "80", "82", "83", "84"])
        .describe("PHP version without dot: 74=7.4, 80=8.0, 82=8.2, 83=8.3, 84=8.4"),
      handler: z
        .enum(["php_fpm", "fcgi"])
        .default("fcgi")
        .describe("PHP handler: php_fpm is faster, fcgi simpler. Use site_get on existing sites to see what this project prefers."),
      database: z
        .object({
          name: z.string().min(1).max(64),
          charset: z.string().default("utf8"),
          server_id: z.number().int().positive(),
          user_login: z.string().min(1),
          user_password: z.string().min(8),
        })
        .optional()
        .describe("Optionally create a new database linked to this site. Omit to skip DB creation."),
      ftp_account: z
        .object({
          username: z.string().min(1),
          password: z.string().min(8),
        })
        .optional()
        .describe("Optionally create an FTP account. Omit to skip."),
      confirm: z.boolean().default(false),
      dry_run: z.boolean().default(false),
    },
    async (args) => {
      try {
        if (!args.owner_id && !args.new_owner) {
          throw new Error("Either owner_id (existing user) or new_owner (create new) is required.");
        }
        if (args.owner_id && args.new_owner) {
          throw new Error("Specify only one of owner_id or new_owner, not both.");
        }

        const aliasesPayload = args.aliases.map((name) => ({ name }));
        const ipsPayload = args.ips.map((ip) => ({ ip }));

        const dbPayload = args.database
          ? {
              charset: args.database.charset,
              name: args.database.name,
              server_id: args.database.server_id,
              user: {
                login: args.database.user_login,
                password: args.database.user_password,
              },
            }
          : null;

        const ftpPayload = args.ftp_account
          ? { username: args.ftp_account.username, password: args.ftp_account.password }
          : null;

        const masterPayload: Record<string, unknown> = {
          aliases: aliasesPayload,
          domain: args.domain,
          email_domain: false,
          ips: ipsPayload,
          dns_domain: null,
          owner: args.owner_id ?? null,
          ssh_access: null,
          user: args.new_owner
            ? {
                username: args.new_owner.username,
                password: args.new_owner.password,
                quota: args.new_owner.quota,
              }
            : null,
          database: dbPayload,
          type: "php",
          handler: args.handler,
          handler_version: args.php_version,
          ftp_account: ftpPayload,
          sftp_account: null,
          backup_plan_id: null,
        };

        const g = writeGuard(
          { confirm: args.confirm, dry_run: args.dry_run },
          "POST /api/master/domain + PUT /api/master",
          redactPasswords(masterPayload),
        );
        if (g.kind === "dry") return g.result;

        logWrite("POST /api/master/domain", { domain: args.domain, aliases: aliasesPayload });
        const probe = await client.post<{
          data: {
            email_domain: unknown;
            top_email_domain: unknown;
            dns_domain: unknown;
            top_dns_domain: unknown;
          };
        }>("/api/master/domain", { domain: args.domain, aliases: aliasesPayload });

        // If the probe returned existing email/DNS zones, surface them rather than silently overwriting.
        if (
          probe.data.email_domain ||
          probe.data.top_email_domain ||
          probe.data.dns_domain ||
          probe.data.top_dns_domain
        ) {
          return asError(
            new Error(
              `Domain probe returned existing zones that site_create does not yet handle: ${JSON.stringify(probe.data)}. ` +
                `Manual intervention required — use the FastPanel UI for this site, or update site_create to pass these references.`,
            ),
          );
        }

        logWrite("PUT /api/master", redactPasswords(masterPayload));
        const data = await client.put("/api/master", masterPayload);
        return asJsonText(data);
      } catch (err) {
        return asError(err);
      }
    },
  );
}
