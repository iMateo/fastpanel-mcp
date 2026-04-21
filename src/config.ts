export interface Config {
  baseUrl: string;
  readToken: string;
  writeToken: string | null;
  insecureTls: boolean;
  timeoutMs: number;
}

export function loadConfig(): Config {
  const baseUrl = process.env.FASTPANEL_URL?.replace(/\/+$/, "");
  const readToken = process.env.FASTPANEL_TOKEN;
  const writeToken = process.env.FASTPANEL_WRITE_TOKEN || null;

  if (!baseUrl) {
    throw new Error("FASTPANEL_URL is required (e.g. https://panel.example.com:8888)");
  }
  if (!readToken) {
    throw new Error("FASTPANEL_TOKEN is required — create via `fastpanel users tokens add -s read_only`");
  }

  return {
    baseUrl,
    readToken,
    writeToken,
    insecureTls: process.env.FASTPANEL_INSECURE_TLS === "1",
    timeoutMs: Number(process.env.FASTPANEL_TIMEOUT_MS ?? 30_000),
  };
}
