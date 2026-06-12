import { z } from "zod";
import { FastPanelError } from "./client.js";
import { shq } from "./ssh.js";
function asJsonText(data) {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
}
function asError(err) {
    const msg = err instanceof FastPanelError
        ? `${err.message}\n\nResponse body:\n${JSON.stringify(err.body, null, 2)}`
        : err instanceof Error
            ? err.message
            : String(err);
    return {
        isError: true,
        content: [{ type: "text", text: msg }],
    };
}
function logWrite(op, payload) {
    const ts = new Date().toISOString();
    process.stderr.write(`[${ts}] fastpanel-mcp write: ${op} ${JSON.stringify(payload)}\n`);
}
function writeGuard(args, operation, payload) {
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
        throw new Error(`Refusing to execute ${operation} without confirm:true. ` +
            `Set dry_run:true first to preview the payload, then confirm:true to execute.`);
    }
    return { kind: "proceed" };
}
function redactPasswords(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    if (Array.isArray(obj))
        return obj.map(redactPasswords);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = /password|secret/i.test(k) ? "***" : redactPasswords(v);
    }
    return out;
}
export function registerTools(server, client, ssh) {
    // ──────────────────────────────────────────────────────────────────────────
    // READ TOOLS
    // ──────────────────────────────────────────────────────────────────────────
    server.tool("sites_list", "List all websites managed by FastPanel. Compact mode (default) returns only essential fields — full response is ~3KB per site and can overflow context. Use site_get(id) for full details of a specific site.", {
        limit: z.number().int().positive().max(10000).default(1000).describe("Max rows to return"),
        compact: z
            .boolean()
            .default(true)
            .describe("If true, return only essential fields (id, domain, aliases, ips, owner, enabled, status, https_redirect, http2, size, databases_size, created_at). If false, returns all 40 fields per site."),
    }, async ({ limit, compact }) => {
        try {
            const data = await client.get("/api/sites/list", { "filter[limit]": limit, "filter[type]": "all" });
            if (!compact)
                return asJsonText(data);
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
                const out = {};
                for (const k of keep)
                    if (k in site)
                        out[k] = site[k];
                return out;
            });
            return asJsonText({ data: slim, meta: { count: slim.length, compact: true } });
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_get", "Get full details for a single site by id. Returns all 40 fields including SSL certificate, backend config, permissions, backup plan, stats.", { site_id: z.number().int().positive().describe("Site id from sites_list") }, async ({ site_id }) => {
        try {
            const data = await client.get(`/api/sites/${site_id}`);
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("databases_list", "List all MySQL and PostgreSQL databases. Returns id, name, charset, size, owner, linked site, server, last dump timestamp.", {}, async () => {
        try {
            const data = await client.get("/api/databases");
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("database_servers_list", "List available database servers (MySQL, PostgreSQL). Use the returned ids as server_id in database_create and site_create.", {}, async () => {
        try {
            const data = await client.get("/api/databases/servers");
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("users_list", "List all FastPanel system users (site owners). Returns id, username, home_dir, roles, PHP version, quota, ssh_access, enabled flag.", {}, async () => {
        try {
            const data = await client.get("/api/users");
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("dns_domains_list", "List all DNS zones managed by FastPanel's DNS service. Empty if DNS is not configured.", {}, async () => {
        try {
            const data = await client.get("/api/dns/domains");
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("dns_records_list", "List all DNS records for a specific domain (zone) by its id. Use dns_domains_list first to get ids.", { domain_id: z.number().int().positive().describe("DNS zone id from dns_domains_list") }, async ({ domain_id }) => {
        try {
            const data = await client.get(`/api/dns/domain/${domain_id}/records`);
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("certificates_list", "List all SSL certificates stored in FastPanel (Let's Encrypt and custom). Returns id, name, type, common_name, alternative_name, expiration, linked site. Also injects computed crt_path/key_path — the on-disk paths FastPanel writes certs to (/var/www/httpd-cert/<name>.crt|.key). These are needed when hand-writing a 443 server block after a site is in manual_changes mode. NOTE: the paths are derived from FastPanel's naming convention, not returned by the API — verify on disk (ls /var/www/httpd-cert/) if a cert was imported rather than issued by the panel.", {}, async () => {
        try {
            const data = await client.get("/api/certificates");
            const enriched = (data.data ?? []).map((c) => ({
                ...c,
                crt_path: typeof c.name === "string" ? `/var/www/httpd-cert/${c.name}.crt` : null,
                key_path: typeof c.name === "string" ? `/var/www/httpd-cert/${c.name}.key` : null,
            }));
            return asJsonText({ ...data, data: enriched });
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("system_load", "Get current server load metrics — CPU, memory, disk, uptime. Source: FastPanel's internal /api/loads/full endpoint.", {}, async () => {
        try {
            const data = await client.get("/api/loads/full");
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("queue_list", "List active and recent FastPanel background tasks (backups, migrations, SSL issuance, screenshots, etc) including completed ones.", { limit: z.number().int().positive().max(1000).default(100).describe("Max rows to return") }, async ({ limit }) => {
        try {
            const data = await client.get("/api/queue/list", { "filter[limit]": limit });
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("queue_active", "Poll FastPanel background tasks and get a deterministic done/not-done signal. The raw /api/queue endpoint also returns recently-FINISHED tasks (status SUCCESS/FAILED), which makes naive polling ambiguous. This tool filters to genuinely in-flight tasks by default and adds meta.all_done (true when nothing is still running) so you can loop until done. Set include_finished:true to also see the just-completed tasks (useful to learn whether an async op SUCCEEDED or FAILED).", {
        include_finished: z
            .boolean()
            .default(false)
            .describe("If true, return finished tasks too (with their SUCCESS/FAILED status) instead of only in-flight ones."),
    }, async ({ include_finished }) => {
        try {
            const data = await client.get("/api/queue");
            const tasks = data.data ?? [];
            const FINISHED = new Set(["SUCCESS", "FAILED", "ERROR", "DONE", "CANCELLED"]);
            const isFinished = (t) => FINISHED.has(String(t.status ?? "").toUpperCase());
            const active = tasks.filter((t) => !isFinished(t));
            const out = include_finished ? tasks : active;
            return asJsonText({
                data: out,
                meta: {
                    active_count: active.length,
                    finished_count: tasks.length - active.length,
                    all_done: active.length === 0,
                },
            });
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_logs", "Tail a site's nginx/apache access or error log — no SSH needed. Maps to GET /api/sites/{site_id}/log/{lines}/{type}. " +
        "Use type=frontend_error to debug 404/permission/realpath problems (nginx), backend_error for PHP-FPM/Apache app errors. " +
        "FastPanel quirk: this endpoint returns the log tail inside an 'errors' JSON field and responds with HTTP 400 even on success — an empty log shows as '\\n', a missing file shows a 'Path … not exists' message. This tool normalises that: the log text is always returned under `log`, and 400 is not treated as a failure. Log files live at <user_home>/data/logs/<domain>-<type>.log.", {
        site_id: z.number().int().positive().describe("Site id from sites_list"),
        type: z
            .enum(["frontend_access", "frontend_error", "backend_access", "backend_error"])
            .default("frontend_error")
            .describe("frontend_* = nginx, backend_* = PHP-FPM/Apache; *_error for diagnostics, *_access for traffic"),
        lines: z.number().int().positive().max(5000).default(100).describe("Number of trailing lines to return"),
    }, async ({ site_id, type, lines }) => {
        const path = `/api/sites/${site_id}/log/${lines}/${type}`;
        const normalise = (body) => {
            const text = body && typeof body === "object" && "errors" in body
                ? body.errors
                : body;
            return asJsonText({ site_id, type, lines, log: text });
        };
        try {
            return normalise(await client.get(path));
        }
        catch (err) {
            // FastPanel returns 400 + {errors:"<log tail>"} even when the read succeeded.
            if (err instanceof FastPanelError && err.status === 400) {
                return normalise(err.body);
            }
            return asError(err);
        }
    });
    server.tool("site_resources", "List the resources attached to a site — linked databases, sub-domains, DNS zones and email domains. Maps to GET /api/sites/{site_id}/resources. Handy before deleting or migrating a site, or to find which database(s) belong to it.", { site_id: z.number().int().positive().describe("Site id from sites_list") }, async ({ site_id }) => {
        try {
            const data = await client.get(`/api/sites/${site_id}/resources`);
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("backup_plans_list", "List configured backup plans (FastPanel v2 backup system). Maps to GET /api/v2/backup/plans. Empty data array means no backup plans are configured.", {}, async () => {
        try {
            const data = await client.get("/api/v2/backup/plans");
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("me", "Identify the FastPanel account behind the current READ token — username, roles, home dir, ssh access. Maps to GET /api/me. Use to confirm which user/token the server is authenticated as. NOTE: this always reflects the read token; it does not tell you whether a write token is configured.", {}, async () => {
        try {
            const data = await client.get("/api/me");
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("settings_get", "Read panel-wide settings — OS release, license type, upload limit, email notification config, statistics toggles, etc. Maps to GET /api/settings.", {}, async () => {
        try {
            const data = await client.get("/api/settings");
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    // ──────────────────────────────────────────────────────────────────────────
    // SSH-BACKED TOOLS — require FASTPANEL_SSH_HOST; run on the panel host itself
    // ──────────────────────────────────────────────────────────────────────────
    server.tool("nginx_validate", "Run `nginx -t` on the FastPanel host (over SSH) to validate the live nginx config — use it before and after site_configuration_update to catch syntax errors that would otherwise take nginx (and every site on it) down. Read-only: does NOT reload or modify anything. Requires SSH configured (FASTPANEL_SSH_HOST); uses your own ssh client.", {}, async () => {
        try {
            const res = await ssh.exec("nginx -t 2>&1");
            const ok = /test is successful/i.test(res.stdout);
            return asJsonText({ ok, exit_code: res.code, output: res.stdout.trim() });
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_doctor", "Diagnose the common reasons a FastPanel site serves errors — runs host-level checks over SSH and returns a structured report. Catches the classic traps: docroot missing, a parent directory without o+x so nginx (www-data) can't traverse to the docroot (the 750 → '404 File not found' / 'permission denied' problem), missing PHP-FPM socket, dead backend service, and broken nginx config. Read-only. Requires SSH configured (FASTPANEL_SSH_HOST).", { site_id: z.number().int().positive().describe("Site id from sites_list") }, async ({ site_id }) => {
        try {
            const resp = await client.get(`/api/sites/${site_id}`);
            const site = resp.data ?? {};
            const docroot = String(site.index_dir ?? "");
            const socket = String(site.main_backend?.socket_path ?? "");
            const service = String(site.main_backend?.service_name ?? "");
            if (!docroot)
                throw new Error(`Site ${site_id} has no index_dir to check.`);
            const remote = [
                `d=${shq(docroot)}`,
                `sock=${shq(socket)}`,
                `svc=${shq(service)}`,
                `[ -d "$d" ] && echo DOCROOT_EXISTS=yes || echo DOCROOT_EXISTS=no`,
                `echo "DOCROOT_STAT=$(stat -c '%a %U:%G' "$d" 2>/dev/null)"`,
                `p="$d"; bad=""; while [ -n "$p" ] && [ "$p" != "/" ]; do perm=$(stat -c '%a' "$p" 2>/dev/null); last=$(printf '%s' "$perm" | tail -c1); case "$last" in 1|3|5|7) : ;; *) bad="$bad $p($perm)" ;; esac; p=$(dirname "$p"); done; echo "TRAVERSAL_BAD=$bad"`,
                `[ -n "$sock" ] && { [ -S "$sock" ] && echo SOCKET=ok || echo SOCKET=missing; } || echo SOCKET=n/a`,
                `[ -n "$svc" ] && echo "SERVICE=$(systemctl is-active "$svc" 2>/dev/null)" || echo SERVICE=n/a`,
                `nginx -t >/dev/null 2>&1 && echo NGINX=ok || echo NGINX=fail`,
            ].join("\n");
            const res = await ssh.exec(remote);
            const map = {};
            for (const line of res.stdout.split("\n")) {
                const i = line.indexOf("=");
                if (i > 0)
                    map[line.slice(0, i)] = line.slice(i + 1).trim();
            }
            const docrootExists = map.DOCROOT_EXISTS === "yes";
            const traversalBad = (map.TRAVERSAL_BAD ?? "").trim();
            const nginxOk = map.NGINX === "ok";
            const checks = {
                docroot_exists: { ok: docrootExists, path: docroot },
                docroot_perms: { detail: map.DOCROOT_STAT || "(unknown)" },
                path_traversal: traversalBad
                    ? {
                        ok: false,
                        detail: `nginx (www-data) cannot traverse to docroot — missing o+x on:${traversalBad}. This is the classic 750 → "404 File not found" / permission-denied cause. Fix with chmod o+x on each listed dir.`,
                    }
                    : { ok: true, detail: "every ancestor directory has o+x" },
                fpm_socket: { detail: map.SOCKET ?? "n/a", note: "n/a is normal for php_fpm pools that listen on a port instead of a socket" },
                backend_service: { detail: map.SERVICE ?? "n/a" },
                nginx_config: {
                    ok: nginxOk,
                    detail: nginxOk ? "nginx -t passed" : "nginx -t FAILED — run nginx_validate for the error",
                },
            };
            const overall_ok = docrootExists && !traversalBad && nginxOk;
            return asJsonText({ site_id, domain: site.domain, overall_ok, checks });
        }
        catch (err) {
            return asError(err);
        }
    });
    const resolveLocalMysqlDb = async (database_id) => {
        const list = await client.get("/api/databases");
        const db = (list.data ?? []).find((d) => d.id === database_id);
        if (!db?.name)
            throw new Error(`Database ${database_id} not found in databases_list.`);
        // Fail closed: only proceed when the metadata positively proves local MySQL.
        if (db.server?.local !== true) {
            throw new Error(`Database ${database_id} is not on a confirmed local DB server — SSH dump/import only supports the local server.`);
        }
        if (db.server?.type !== "mysql") {
            throw new Error(`Database ${database_id} engine must be mysql (got '${db.server?.type ?? "unknown"}') — SSH dump/import is MySQL-only.`);
        }
        return db.name;
    };
    // SSH dump/import are confined to this staging dir so an LLM-driven call can never
    // mysqldump over /etc/* or read an arbitrary file. Configurable for non-root SSH users.
    const SSH_STAGING_DIR = (process.env.FASTPANEL_DUMP_DIR?.trim() || "/root/fastpanel-mcp-dumps").replace(/\/+$/, "");
    const assertInStaging = (p) => {
        if (!p.startsWith("/") || p.includes("..")) {
            throw new Error(`Path must be absolute with no '..' segments: ${p}`);
        }
        if (p !== SSH_STAGING_DIR && !p.startsWith(SSH_STAGING_DIR + "/")) {
            throw new Error(`Path must be inside the staging dir ${SSH_STAGING_DIR} (set FASTPANEL_DUMP_DIR to change it).`);
        }
        if (!p.endsWith(".sql"))
            throw new Error("Path must end with .sql");
        return p;
    };
    server.tool("database_dump", "Dump a database to a .sql file ON the FastPanel host via SSH (mysqldump). Writes a file you can then download (scp/sftp); returns the path and byte size. The file can only be written inside the staging dir (default /root/fastpanel-mcp-dumps, override with FASTPANEL_DUMP_DIR) — arbitrary output paths are rejected. Targets the host's LOCAL MySQL via root socket auth; remote servers and non-MySQL engines are rejected. WRITE (it creates a root-owned file) — set dry_run:true to preview, confirm:true to execute. Requires SSH configured (FASTPANEL_SSH_HOST).", {
        database_id: z.number().int().positive().describe("Database id from databases_list"),
        output_path: z
            .string()
            .optional()
            .describe("Absolute .sql path INSIDE the staging dir. Default: <staging>/<name>-<timestamp>.sql"),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
    }, async ({ database_id, output_path, confirm, dry_run }) => {
        try {
            const name = await resolveLocalMysqlDb(database_id);
            const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
            const path = output_path
                ? assertInStaging(output_path)
                : `${SSH_STAGING_DIR}/${name}-${ts}.sql`;
            const g = writeGuard({ confirm, dry_run }, `ssh: mysqldump ${name} > ${path}`, {
                database: name,
                path,
            });
            if (g.kind === "dry")
                return g.result;
            // `mkdir -m 700 -p` only sets the mode when creating the dir; it never widens an
            // existing directory's permissions, so a pre-existing system dir can't be DoS'd.
            const remote = `mkdir -m 700 -p ${shq(SSH_STAGING_DIR)} && ` +
                `mysqldump ${shq(name)} > ${shq(path)} && wc -c < ${shq(path)}`;
            logWrite("ssh mysqldump", { database: name, path });
            const res = await ssh.exec(remote);
            if (res.code !== 0)
                throw new Error(`mysqldump failed (exit ${res.code})`);
            const bytes = parseInt(res.stdout.trim(), 10) || null;
            return asJsonText({
                database: name,
                path,
                bytes,
                note: "File is on the panel host in a 0700 dir. Download via scp/sftp, then remove it when done.",
            });
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("database_import", "Load a .sql dump file (already present on the host) INTO a database via SSH (mysql). DESTRUCTIVE: the SQL runs as-is, so a dump containing DROP/CREATE will replace existing tables and data. The source file must live inside the staging dir (default /root/fastpanel-mcp-dumps, override with FASTPANEL_DUMP_DIR) — paths elsewhere are rejected, so scp the file there first (or produce it with database_dump). Targets the local MySQL via root socket auth. WRITE — set dry_run:true to preview the command, confirm:true to execute. Requires SSH configured (FASTPANEL_SSH_HOST).", {
        database_id: z.number().int().positive().describe("Target database id from databases_list"),
        source_path: z.string().min(1).describe("Absolute path to the .sql file, inside the staging dir"),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
    }, async ({ database_id, source_path, confirm, dry_run }) => {
        try {
            const name = await resolveLocalMysqlDb(database_id);
            const src = assertInStaging(source_path);
            const g = writeGuard({ confirm, dry_run }, `ssh: mysql ${name} < ${src}`, { database: name, source_path: src, warning: "Runs the SQL as-is; may DROP/replace existing data." });
            if (g.kind === "dry")
                return g.result;
            const remote = `test -f ${shq(src)} && mysql ${shq(name)} < ${shq(src)}`;
            logWrite("ssh mysql import", { database: name, source_path: src });
            const res = await ssh.exec(remote);
            // Do not echo remote stderr — it could surface file contents on a malformed source.
            if (res.code !== 0) {
                throw new Error(`import failed (exit ${res.code}) — check the source file exists and is valid SQL.`);
            }
            return asJsonText({ database: name, source_path: src, status: "imported" });
        }
        catch (err) {
            return asError(err);
        }
    });
    // Resolve a site's web root (index_dir) and the system user that must own its files.
    // FastPanel wraps the site in {data:…}; files served by nginx/PHP-FPM must be owned by
    // owner.username, NOT root, or the panel/serving breaks — every upload tool chowns to it.
    const resolveSiteRoot = async (site_id) => {
        const resp = await client.get(`/api/sites/${site_id}`);
        const site = resp.data ?? {};
        const root = String(site.index_dir ?? "").replace(/\/+$/, "");
        const user = String(site.owner?.username ?? "");
        if (!root)
            throw new Error(`Site ${site_id} has no index_dir (web root) to upload into.`);
        if (!user)
            throw new Error(`Site ${site_id} has no resolvable owner.username for chown.`);
        return { user, root };
    };
    // Web-path safety: a destination subpath must stay inside the site's web root and may
    // only use web-safe characters — this also neutralises shell expansion of the remote
    // path (rsync/git run it through the host shell) and directory-escape attempts.
    const SAFE_SUBPATH = /^[A-Za-z0-9._/-]+$/;
    const resolveDest = (root, subpath) => {
        const sub = (subpath ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
        if (!sub)
            return root;
        if (sub.split("/").some((seg) => seg === "..")) {
            throw new Error(`subpath must not contain '..' segments: ${subpath}`);
        }
        if (!SAFE_SUBPATH.test(sub)) {
            throw new Error(`subpath may only contain letters, digits, '.', '_', '-', '/': ${subpath}`);
        }
        const dest = `${root}/${sub}`;
        if (!dest.startsWith(root + "/")) {
            throw new Error(`Resolved destination escapes the site web root: ${dest}`);
        }
        return dest;
    };
    server.tool("site_files_upload", "Upload a local file or directory from THIS machine into a site's web root, over SSH (rsync, scp fallback). Resolves the site's index_dir + owner via site_get, transfers with your own ssh key (bytes never pass through the model), then chowns to the site's system user AND normalises perms on the destination subtree to FastPanel's web defaults (dirs 755, files 644) so nginx/PHP-FPM can serve it (local file modes are not relied on). " +
        "rsync TRAILING-SLASH semantics: local_path 'build/' uploads the CONTENTS of build into the destination; 'build' (no slash) uploads the build dir itself, creating <dest>/build. dest_subpath is relative to the web root (omit to target the root). " +
        "delete:true mirrors the source (rsync --delete removes remote files absent locally) — needs rsync, gated behind confirm. WRITE — set dry_run:true to preview, confirm:true to execute. Requires SSH configured (FASTPANEL_SSH_HOST).", {
        site_id: z.number().int().positive().describe("Site id from sites_list"),
        local_path: z
            .string()
            .min(1)
            .describe("Path on THIS machine to a file or directory. Trailing slash on a dir uploads its contents."),
        dest_subpath: z
            .string()
            .optional()
            .describe("Destination relative to the site web root (e.g. 'public' or 'wp-content/uploads'). Omit for the web root itself."),
        delete: z
            .boolean()
            .default(false)
            .describe("rsync --delete: make the remote an exact mirror of local_path, removing remote-only files. Destructive."),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
    }, async ({ site_id, local_path, dest_subpath, delete: del, confirm, dry_run }) => {
        try {
            const { user, root } = await resolveSiteRoot(site_id);
            const dest = resolveDest(root, dest_subpath);
            const g = writeGuard({ confirm, dry_run }, `ssh: rsync ${local_path} → ${dest} (chown ${user}:${user})`, {
                local_path,
                dest,
                owner: user,
                delete: del,
                note: "Trailing slash on local_path matters: 'dir/' uploads contents, 'dir' uploads the dir itself.",
            });
            if (g.kind === "dry")
                return g.result;
            logWrite("ssh rsync upload", { local_path, dest, owner: user, delete: del });
            // umask 022 so any NEWLY created dir is 755 (traversable by nginx/www-data) — root's
            // default 077 would make it 700 and unservable. Existing dirs are left untouched.
            const mk = await ssh.exec(`(umask 022; mkdir -p ${shq(dest)})`);
            if (mk.code !== 0)
                throw new Error(`could not create destination ${dest} (exit ${mk.code})`);
            const res = await ssh.upload(local_path, dest, { delete: del });
            if (res.code !== 0) {
                throw new Error(`transfer failed (exit ${res.code})${res.stderr ? ": " + res.stderr.trim() : ""}`);
            }
            // Normalise ownership + web perms on the server (not via rsync --chmod: the local
            // rsync version can't be trusted — old macOS rsync ignores it). dirs→755, files→644
            // is FastPanel's own default and what nginx/PHP-FPM need to traverse/read. chown
            // covers the topmost dir we created (so root-owned intermediates don't linger);
            // perms are normalised only on the uploaded subtree.
            const sub = (dest_subpath ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
            const chownTarget = sub ? `${root}/${sub.split("/")[0]}` : dest;
            const fix = await ssh.exec(`chown -R ${shq(`${user}:${user}`)} ${shq(chownTarget)} && ` +
                `find ${shq(dest)} -type d -exec chmod 755 {} + && ` +
                `find ${shq(dest)} -type f -exec chmod 644 {} +`);
            if (fix.code !== 0) {
                throw new Error(`transfer ok but chown/chmod failed (exit ${fix.code}) — files may be root-owned or unservable. Fix: chown -R ${user}:${user} ${dest}`);
            }
            return asJsonText({
                dest,
                owner: user,
                status: "uploaded",
                transfer_summary: res.stdout.trim().split("\n").slice(-14).join("\n"),
            });
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_files_deploy", "Deploy site files onto the host by fetching them ON the server (no local copy needed) — git clone or a downloaded tarball — into the site's web root, then chowning to the site's system user. Resolves index_dir + owner via site_get. The fetch runs as root on the panel host; only https:// sources are accepted. " +
        "source_type 'git': shallow-clones source (optionally at `ref`) and copies the tree (excluding .git) into the destination. source_type 'tarball': curls the archive and extracts it; a single wrapping top-level directory (e.g. GitHub's repo-main/) is descended into automatically. Existing files are overwritten; nothing is deleted. dest_subpath is relative to the web root. WRITE — dry_run:true to preview, confirm:true to execute. Requires SSH (FASTPANEL_SSH_HOST).", {
        site_id: z.number().int().positive().describe("Site id from sites_list"),
        source: z
            .string()
            .min(1)
            .regex(/^https:\/\//, "source must be an https:// URL")
            .describe("https:// git repo URL (source_type=git) or https:// .tar.gz archive URL (source_type=tarball)"),
        source_type: z
            .enum(["git", "tarball"])
            .default("git")
            .describe("git = clone a repo; tarball = download and extract a .tar.gz"),
        ref: z
            .string()
            .regex(/^[A-Za-z0-9._/-]+$/, "ref may only contain letters, digits, '.', '_', '-', '/'")
            .optional()
            .describe("git branch/tag to check out (source_type=git only). Omit for the default branch."),
        dest_subpath: z
            .string()
            .optional()
            .describe("Destination relative to the site web root. Omit for the web root itself."),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
    }, async ({ site_id, source, source_type, ref, dest_subpath, confirm, dry_run }) => {
        try {
            const { user, root } = await resolveSiteRoot(site_id);
            const dest = resolveDest(root, dest_subpath);
            const own = shq(`${user}:${user}`);
            const remote = source_type === "git"
                ? [
                    "set -e",
                    "umask 022", // new dirs/files become 755/644 so nginx can serve them
                    'tmp=$(mktemp -d)',
                    `trap 'rm -rf "$tmp"' EXIT`,
                    `git clone --depth 1 ${ref ? `--branch ${shq(ref)} ` : ""}${shq(source)} "$tmp/repo"`,
                    `mkdir -p ${shq(dest)}`,
                    `( cd "$tmp/repo" && tar -cf - --exclude=.git . ) | ( cd ${shq(dest)} && tar -xf - )`,
                    `chown -R ${own} ${shq(dest)}`,
                ].join("\n")
                : [
                    "set -e",
                    "umask 022", // new dirs/files become 755/644 so nginx can serve them
                    'tmp=$(mktemp -d)',
                    `trap 'rm -rf "$tmp"' EXIT`,
                    `curl -fsSL ${shq(source)} -o "$tmp/archive"`,
                    `mkdir -p "$tmp/x" && tar -xf "$tmp/archive" -C "$tmp/x"`,
                    // If the archive unpacked to a single top-level dir, deploy its contents.
                    `inner="$tmp/x"; if [ "$(ls -A "$tmp/x" | wc -l)" = "1" ]; then only="$tmp/x/$(ls -A "$tmp/x")"; [ -d "$only" ] && inner="$only"; fi`,
                    `mkdir -p ${shq(dest)}`,
                    `( cd "$inner" && tar -cf - . ) | ( cd ${shq(dest)} && tar -xf - )`,
                    `chown -R ${own} ${shq(dest)}`,
                ].join("\n");
            const g = writeGuard({ confirm, dry_run }, `ssh: deploy ${source_type} ${source} → ${dest} (chown ${user}:${user})`, { source, source_type, ref: ref ?? null, dest, owner: user, remote_script: remote });
            if (g.kind === "dry")
                return g.result;
            logWrite("ssh deploy", { source, source_type, ref: ref ?? null, dest, owner: user });
            const res = await ssh.exec(remote);
            if (res.code !== 0) {
                throw new Error(`deploy failed (exit ${res.code})${res.stderr ? ": " + res.stderr.trim() : ""}`);
            }
            return asJsonText({ dest, owner: user, source, source_type, ref: ref ?? null, status: "deployed" });
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_file_put", "Write a single small file into a site's web root from inline content, over SSH, then chown it to the site's system user. For quick one-off files (index.html placeholder, .htaccess, robots.txt) — the content travels through the model, so keep it small; use site_files_upload/site_files_deploy for real payloads. rel_path is the file path relative to the web root; parent directories are created as needed. WRITE — dry_run:true to preview, confirm:true to execute. Requires SSH (FASTPANEL_SSH_HOST).", {
        site_id: z.number().int().positive().describe("Site id from sites_list"),
        rel_path: z
            .string()
            .min(1)
            .regex(/^[A-Za-z0-9._/-]+$/, "rel_path may only contain letters, digits, '.', '_', '-', '/'")
            .describe("File path relative to the web root, e.g. 'index.html' or 'assets/robots.txt'"),
        content: z
            .string()
            .max(262144)
            .describe("File contents (max 256KB). Use encoding:'base64' for binary."),
        encoding: z
            .enum(["utf8", "base64"])
            .default("utf8")
            .describe("How `content` is encoded. base64 for binary files."),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
    }, async ({ site_id, rel_path, content, encoding, confirm, dry_run }) => {
        try {
            const rel = rel_path.replace(/^\/+/, "");
            if (rel.endsWith("/") || rel.split("/").some((seg) => seg === ".." || seg === "")) {
                throw new Error(`rel_path must be a clean file path with no '..' or trailing slash: ${rel_path}`);
            }
            const { user, root } = await resolveSiteRoot(site_id);
            const fullPath = `${root}/${rel}`;
            if (!fullPath.startsWith(root + "/")) {
                throw new Error(`Resolved path escapes the site web root: ${fullPath}`);
            }
            const parent = fullPath.slice(0, fullPath.lastIndexOf("/"));
            const slash = rel.indexOf("/");
            // chown the topmost newly-created dir (or the file itself if it lands at the root).
            const chownTarget = slash >= 0 ? `${root}/${rel.slice(0, slash)}` : fullPath;
            const buf = Buffer.from(content, encoding);
            const g = writeGuard({ confirm, dry_run }, `ssh: write ${buf.length} bytes → ${fullPath} (chown ${user}:${user})`, { path: fullPath, bytes: buf.length, encoding, owner: user });
            if (g.kind === "dry")
                return g.result;
            logWrite("ssh file put", { path: fullPath, bytes: buf.length, owner: user });
            // umask 022 so newly created parent dirs are 755 (nginx-traversable), not root's 700.
            const mk = await ssh.exec(`(umask 022; mkdir -p ${shq(parent)})`);
            if (mk.code !== 0)
                throw new Error(`could not create parent dir ${parent} (exit ${mk.code})`);
            const res = await ssh.putContent(buf, fullPath);
            if (res.code !== 0) {
                throw new Error(`write failed (exit ${res.code})${res.stderr ? ": " + res.stderr.trim() : ""}`);
            }
            // `cat >` created the file under root's umask (→ 600). Force 644 so nginx can read it,
            // then chown the file (and any dirs we just created) to the site user.
            const fix = await ssh.exec(`chmod 644 ${shq(fullPath)} && chown -R ${shq(`${user}:${user}`)} ${shq(chownTarget)}`);
            if (fix.code !== 0) {
                throw new Error(`write ok but chmod/chown failed (exit ${fix.code}) — file may be root-owned or unreadable. Fix: chmod 644 ${fullPath} && chown ${user}:${user} ${fullPath}`);
            }
            return asJsonText({ path: fullPath, bytes: buf.length, owner: user, status: "written" });
        }
        catch (err) {
            return asError(err);
        }
    });
    // ──────────────────────────────────────────────────────────────────────────
    // WRITE TOOLS — each requires confirm:true, supports dry_run:true
    // ──────────────────────────────────────────────────────────────────────────
    server.tool("user_create", "Create a new FastPanel system user (site owner). This is a WRITE operation — set dry_run:true to preview, confirm:true to execute.", {
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
    }, async ({ username, password, roles, quota, confirm, dry_run }) => {
        try {
            const payload = { username, password, roles, quota };
            const g = writeGuard({ confirm, dry_run }, "POST /api/users", redactPasswords(payload));
            if (g.kind === "dry")
                return g.result;
            logWrite("POST /api/users", redactPasswords(payload));
            const data = await client.post("/api/users", payload);
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("database_create", "Create a new database (MySQL or PostgreSQL) with a dedicated DB user. WRITE operation — set dry_run:true to preview, confirm:true to execute.", {
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
    }, async ({ name, charset, server_id, owner_id, site_id, db_user_login, db_user_password, confirm, dry_run, }) => {
        try {
            const payload = {
                charset,
                name,
                owner_id,
                server_id,
                site: site_id,
                user: { login: db_user_login, password: db_user_password },
            };
            const g = writeGuard({ confirm, dry_run }, "POST /api/databases", redactPasswords(payload));
            if (g.kind === "dry")
                return g.result;
            logWrite("POST /api/databases", redactPasswords(payload));
            const data = await client.post("/api/databases", payload);
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_ssl_update", "Attach, replace, or detach an SSL certificate on an existing site, and toggle HTTPS flags. Maps to PUT /api/sites/{site_id}. Use for wildcard flow: create site in *.icstudio.space, then attach an existing wildcard cert. Pass certificate_id=null to detach. WRITE — confirm:true required.", {
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
    }, async ({ site_id, confirm, dry_run, ...fields }) => {
        try {
            // Only include fields that were actually passed (support partial update).
            const payload = { manual_changes: fields.manual_changes };
            payload.certificate = fields.certificate_id;
            if (fields.https_redirect !== undefined)
                payload.https_redirect = fields.https_redirect;
            if (fields.hsts !== undefined)
                payload.hsts = fields.hsts;
            if (fields.http2 !== undefined)
                payload.http2 = fields.http2;
            if (fields.http3 !== undefined)
                payload.http3 = fields.http3;
            const g = writeGuard({ confirm, dry_run }, `PUT /api/sites/${site_id}`, payload);
            if (g.kind === "dry")
                return g.result;
            logWrite(`PUT /api/sites/${site_id}`, payload);
            const data = await client.put(`/api/sites/${site_id}`, payload);
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_update", "Change a site's document root (index_dir) and/or directory index, via PUT /api/sites/{site_id}. This is the ONLY way to repoint a site's docroot — nginx renders `root` from site.index_dir, NOT from the backend, so site_backend_update can't do it. Common need: frameworks that serve from a subfolder (Laravel/Symfony → <docroot>/public). Pass framework:'laravel' to auto-append '/public' to the current docroot without computing the path yourself. " +
        "This tool does a read-modify-write: it fetches the current site via site_get and resends the writable fields (docroot, index page, current certificate id, https/http2/http3/hsts flags) so the partial PUT doesn't blank out SSL or flags. " +
        "⚠️ UNVERIFIED ENDPOINT: the index_dir write path was not confirmable from the API spec (FastPanel has no OpenAPI). Run with dry_run:true, then a real call on a throwaway site, and check site_get afterwards. If index_dir does NOT change, capture the DevTools request the panel UI fires when you edit the docroot and report it so this can be corrected. WRITE — confirm:true required.", {
        site_id: z.number().int().positive().describe("Site id from sites_list"),
        index_dir: z
            .string()
            .optional()
            .describe("New absolute document root, e.g. /var/www/www-root/data/www/<domain>/public. Omit if using `framework`."),
        framework: z
            .enum(["laravel", "symfony"])
            .optional()
            .describe("Preset: sets docroot to <current_index_dir>/public. Ignored if index_dir is given explicitly."),
        index_page: z
            .string()
            .optional()
            .describe("Directory index, e.g. 'index.php index.html'. Omit to keep current."),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
    }, async ({ site_id, index_dir, framework, index_page, confirm, dry_run }) => {
        try {
            const resp = await client.get(`/api/sites/${site_id}`);
            const site = resp.data ?? {};
            let newDir = index_dir;
            if (!newDir && framework) {
                const base = (site.index_dir ?? "").replace(/\/+$/, "");
                newDir = `${base}/public`;
            }
            if (!newDir) {
                throw new Error("Provide either index_dir or framework — nothing to change.");
            }
            const payload = {
                index_dir: newDir,
                index_page: index_page ?? site.index_page,
                certificate: site.certificate?.id ?? null,
                https_redirect: site.https_redirect ?? false,
                http2: site.http2 ?? false,
                http3: site.http3 ?? false,
                hsts: site.hsts ?? false,
                manual_changes: false,
            };
            const g = writeGuard({ confirm, dry_run }, `PUT /api/sites/${site_id}`, {
                previous_index_dir: site.index_dir,
                ...payload,
            });
            if (g.kind === "dry")
                return g.result;
            logWrite(`PUT /api/sites/${site_id}`, { index_dir: newDir, index_page: payload.index_page });
            const data = await client.put(`/api/sites/${site_id}`, payload);
            return asJsonText({ previous_index_dir: site.index_dir, new_index_dir: newDir, result: data });
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("certificate_create_letsencrypt", "Issue a Let's Encrypt SSL certificate for an existing site. This is ASYNC — response returns immediately with status 'CREATING'. Poll queue_active to track issuance progress. REQUIREMENTS: site must be publicly accessible with correct DNS for HTTP-01 challenge to succeed. WRITE operation — confirm:true to execute.", {
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
    }, async ({ site_id, email, common_name, alternative_names, force_dns_validation, key_length, confirm, dry_run, }) => {
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
            if (g.kind === "dry")
                return g.result;
            logWrite("POST /api/certificates", payload);
            const data = await client.post("/api/certificates", payload);
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_configuration_get", "Read the raw nginx (frontend), apache (backend) and php.ini configs for a site. Returns the literal config text as stored by FastPanel. Use before site_configuration_update to see current state — FastPanel's default configs often miss hardening (no .git/.env blocking, etc). Endpoint: GET /api/sites/{site_id}/configuration.", { site_id: z.number().int().positive().describe("Site id from sites_list") }, async ({ site_id }) => {
        try {
            const data = await client.get(`/api/sites/${site_id}/configuration`);
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_configuration_update", "Replace the nginx (frontend), apache (backend) and php.ini config for a site. DANGEROUS: invalid syntax can take down the site or the whole nginx/apache service — this tool does NOT validate nginx syntax before applying (no `nginx -t`), so preview with dry_run and double-check by hand. " +
        "⚠️ SIDE EFFECT — manual mode: the first config update flips the site to manual_changes=true on the panel side. After that, FastPanel STOPS managing this site's config: it will no longer auto-insert the 443 server block, the HTTP→HTTPS redirect, or Let's Encrypt renewal/acme-challenge locations when you issue or renew SSL. You become responsible for the full HTTPS block (including ssl_certificate paths — get them from certificates_list crt_path/key_path). " +
        "Partial update IS supported here (unlike the raw API): omit any of frontend/backend/phpini and the tool fetches the current value via site_configuration_get and sends it back unchanged, so you can safely change just one block. Endpoint: PUT /api/sites/{site_id}/configuration. WRITE — confirm:true required.", {
        site_id: z.number().int().positive().describe("Site id from sites_list"),
        frontend: z
            .string()
            .optional()
            .describe("Full nginx config for this site (HTTPS server block + HTTP redirect block). Omit to keep current."),
        backend: z
            .string()
            .optional()
            .describe("Full apache/httpd config for this site (VirtualHost block). Omit to keep current."),
        phpini: z.string().optional().describe("Full php.ini overrides for this site. Omit to keep current."),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
    }, async ({ site_id, frontend, backend, phpini, confirm, dry_run }) => {
        try {
            // Partial update: fetch current config for any omitted block so we never blank one out.
            let current;
            if (frontend === undefined || backend === undefined || phpini === undefined) {
                const cfg = await client.get(`/api/sites/${site_id}/configuration`);
                current = cfg.data ?? {};
            }
            frontend = frontend ?? current?.frontend ?? "";
            backend = backend ?? current?.backend ?? "";
            phpini = phpini ?? current?.phpini ?? "";
            const payload = { frontend, backend, phpini };
            const summary = {
                frontend_bytes: frontend.length,
                backend_bytes: backend.length,
                phpini_bytes: phpini.length,
                frontend_preview: frontend.slice(0, 200),
                backend_preview: backend.slice(0, 200),
                phpini_preview: phpini.slice(0, 200),
            };
            const g = writeGuard({ confirm, dry_run }, `PUT /api/sites/${site_id}/configuration`, summary);
            if (g.kind === "dry")
                return g.result;
            logWrite(`PUT /api/sites/${site_id}/configuration`, {
                frontend_bytes: frontend.length,
                backend_bytes: backend.length,
                phpini_bytes: phpini.length,
            });
            const data = await client.put(`/api/sites/${site_id}/configuration`, payload);
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_backend_update", "Update backend settings of an existing site: PHP version, handler (php_fpm/fcgi), app file, port, socket path, env vars. Pass the SITE id (from sites_list) — this tool resolves the backend id internally (the API endpoint is PUT /api/sites/backend/{backend_id}, where backend_id = main_backend.id, NOT the site id; passing a site id there 404s). All settings except site_id are optional: omitted fields keep the site's current backend values (fetched via site_get). NOTE: this does NOT change the site's document root (site.index_dir) — nginx renders `root` from the site object, not the backend. Use site_update for docroot. WRITE — confirm:true required.", {
        site_id: z.number().int().positive().describe("Site id from sites_list (backend id is resolved automatically)"),
        type: z.enum(["php", "nodejs", "python"]).optional().describe("Backend runtime type (default: keep current)"),
        handler: z.enum(["php_fpm", "fcgi"]).optional().describe("PHP handler (only meaningful for type=php; default: keep current)"),
        handler_version: z
            .enum(["74", "80", "81", "82", "83", "84"])
            .optional()
            .describe("PHP version without dot (default: keep current)"),
        app_file: z.string().optional().describe("Entry file (default: keep current)"),
        port: z.number().int().min(1024).max(65535).optional().describe("Backend listen port (default: keep current)"),
        socket_path: z.string().optional().describe("Unix socket path for the backend (default: keep current)"),
        manual_changes: z
            .boolean()
            .default(false)
            .describe("Preserve manual changes to backend config"),
        environment: z.array(z.string()).optional().describe("Env vars, e.g. ['KEY=val'] (default: keep current)"),
        work_dir: z.string().optional().describe("Working directory (default: keep current)"),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
    }, async ({ site_id, confirm, dry_run, ...rest }) => {
        try {
            const resp = await client.get(`/api/sites/${site_id}`);
            const site = resp.data ?? {};
            const cur = site.main_backend;
            if (!cur?.id) {
                throw new Error(`Site ${site_id} has no resolvable backend (main_backend.id missing). It may be a static site with no PHP/app backend.`);
            }
            const backendId = cur.id;
            const payload = {
                type: rest.type ?? cur.type ?? "php",
                handler: rest.handler ?? cur.handler,
                handler_version: rest.handler_version ?? cur.handler_version,
                app_file: rest.app_file ?? cur.app_file ?? "index.php",
                port: rest.port ?? cur.port,
                socket_path: rest.socket_path ?? cur.socket_path,
                index_dir: site.index_dir,
                manual_changes: rest.manual_changes,
                environment: rest.environment ?? cur.environment ?? [""],
                work_dir: rest.work_dir ?? cur.work_dir ?? "",
            };
            const path = `/api/sites/backend/${backendId}`;
            const g = writeGuard({ confirm, dry_run }, `PUT ${path}`, { backend_id: backendId, ...payload });
            if (g.kind === "dry")
                return g.result;
            logWrite(`PUT ${path}`, payload);
            const data = await client.put(path, payload);
            return asJsonText({ backend_id: backendId, result: data });
        }
        catch (err) {
            return asError(err);
        }
    });
    server.tool("site_create", "Create a new website in FastPanel using the /api/master wizard endpoint. Can create owner/database/FTP inline atomically. Does NOT issue SSL — call certificate_create_letsencrypt after site is active. WRITE operation — set dry_run:true first, then confirm:true to execute. Flow: (1) POST /api/master/domain probes for existing email/DNS zones, (2) PUT /api/master creates the site with everything.", {
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
    }, async (args) => {
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
            const masterPayload = {
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
            const g = writeGuard({ confirm: args.confirm, dry_run: args.dry_run }, "POST /api/master/domain + PUT /api/master", redactPasswords(masterPayload));
            if (g.kind === "dry")
                return g.result;
            logWrite("POST /api/master/domain", { domain: args.domain, aliases: aliasesPayload });
            const probe = await client.post("/api/master/domain", { domain: args.domain, aliases: aliasesPayload });
            // If the probe returned existing email/DNS zones, surface them rather than silently overwriting.
            if (probe.data.email_domain ||
                probe.data.top_email_domain ||
                probe.data.dns_domain ||
                probe.data.top_dns_domain) {
                return asError(new Error(`Domain probe returned existing zones that site_create does not yet handle: ${JSON.stringify(probe.data)}. ` +
                    `Manual intervention required — use the FastPanel UI for this site, or update site_create to pass these references.`));
            }
            logWrite("PUT /api/master", redactPasswords(masterPayload));
            const data = await client.put("/api/master", masterPayload);
            return asJsonText(data);
        }
        catch (err) {
            return asError(err);
        }
    });
}
//# sourceMappingURL=tools.js.map