import { Agent, request } from "undici";
export class FastPanelError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.status = status;
        this.body = body;
        this.name = "FastPanelError";
    }
}
export class FastPanelWriteDisabledError extends Error {
    constructor() {
        super("Write operation attempted but FASTPANEL_WRITE_TOKEN is not set. Create a write token via " +
            "`fastpanel users tokens add -n mcp-write -e YYYY-MM-DD -c <your-ip>` and set FASTPANEL_WRITE_TOKEN.");
        this.name = "FastPanelWriteDisabledError";
    }
}
export class FastPanelClient {
    config;
    dispatcher;
    constructor(config) {
        this.config = config;
        this.dispatcher = new Agent({
            connect: { rejectUnauthorized: !config.insecureTls },
            headersTimeout: config.timeoutMs,
            bodyTimeout: config.timeoutMs,
        });
    }
    get hasWriteToken() {
        return this.config.writeToken !== null;
    }
    async get(path, query) {
        return this.request("GET", path, { query });
    }
    async post(path, body) {
        return this.request("POST", path, { body, requiresWrite: true });
    }
    async patch(path, body) {
        return this.request("PATCH", path, { body, requiresWrite: true });
    }
    async put(path, body) {
        return this.request("PUT", path, { body, requiresWrite: true });
    }
    async delete(path) {
        return this.request("DELETE", path, { requiresWrite: true });
    }
    async request(method, path, opts) {
        const token = opts.requiresWrite ? this.config.writeToken : this.config.readToken;
        if (opts.requiresWrite && !token) {
            throw new FastPanelWriteDisabledError();
        }
        const url = new URL(this.config.baseUrl + path);
        if (opts.query) {
            for (const [k, v] of Object.entries(opts.query)) {
                if (v !== undefined)
                    url.searchParams.set(k, String(v));
            }
        }
        const headers = {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        };
        let body;
        if (opts.body !== undefined) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(opts.body);
        }
        const res = await request(url, { method, dispatcher: this.dispatcher, headers, body });
        const text = await res.body.text();
        let parsed;
        try {
            parsed = text ? JSON.parse(text) : null;
        }
        catch {
            parsed = text;
        }
        if (res.statusCode >= 400) {
            throw new FastPanelError(`FastPanel API ${res.statusCode} on ${method} ${path}`, res.statusCode, parsed);
        }
        return parsed;
    }
    async close() {
        await this.dispatcher.close();
    }
}
//# sourceMappingURL=client.js.map