import { Agent, request } from "undici";
import type { Config } from "./config.js";

export class FastPanelError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "FastPanelError";
  }
}

export class FastPanelWriteDisabledError extends Error {
  constructor() {
    super(
      "Write operation attempted but FASTPANEL_WRITE_TOKEN is not set. Create a write token via " +
        "`fastpanel users tokens add -n mcp-write -e YYYY-MM-DD -c <your-ip>` and set FASTPANEL_WRITE_TOKEN.",
    );
    this.name = "FastPanelWriteDisabledError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export class FastPanelClient {
  private readonly dispatcher: Agent;

  constructor(private readonly config: Config) {
    this.dispatcher = new Agent({
      connect: { rejectUnauthorized: !config.insecureTls },
      headersTimeout: config.timeoutMs,
      bodyTimeout: config.timeoutMs,
    });
  }

  get hasWriteToken(): boolean {
    return this.config.writeToken !== null;
  }

  async get<T = unknown>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body, requiresWrite: true });
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body, requiresWrite: true });
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body, requiresWrite: true });
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path, { requiresWrite: true });
  }

  private async request<T>(
    method: Method,
    path: string,
    opts: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      requiresWrite?: boolean;
    },
  ): Promise<T> {
    const token = opts.requiresWrite ? this.config.writeToken : this.config.readToken;
    if (opts.requiresWrite && !token) {
      throw new FastPanelWriteDisabledError();
    }

    const url = new URL(this.config.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    const res = await request(url, { method, dispatcher: this.dispatcher, headers, body });
    const text = await res.body.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (res.statusCode >= 400) {
      throw new FastPanelError(
        `FastPanel API ${res.statusCode} on ${method} ${path}`,
        res.statusCode,
        parsed,
      );
    }
    return parsed as T;
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
  }
}
