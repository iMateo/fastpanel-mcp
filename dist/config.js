export function loadConfig() {
    const baseUrl = process.env.FASTPANEL_URL?.replace(/\/+$/, "");
    const readToken = process.env.FASTPANEL_TOKEN;
    const writeToken = process.env.FASTPANEL_WRITE_TOKEN || null;
    if (!baseUrl) {
        throw new Error("FASTPANEL_URL is required (e.g. https://panel.example.com:8888)");
    }
    if (!readToken) {
        throw new Error("FASTPANEL_TOKEN is required — create via `fastpanel users tokens add -s read_only`");
    }
    // SSH is opt-in and host-agnostic: it stays null until FASTPANEL_SSH_HOST is set.
    // Everything else has a sensible, overridable default — nothing here is tied to a
    // specific server, so the same build works against any FastPanel host.
    const sshHost = process.env.FASTPANEL_SSH_HOST?.trim();
    const ssh = sshHost
        ? {
            host: sshHost,
            port: Number(process.env.FASTPANEL_SSH_PORT ?? 22),
            user: process.env.FASTPANEL_SSH_USER?.trim() || "root",
            key: process.env.FASTPANEL_SSH_KEY?.trim() || null,
            extraOpts: (process.env.FASTPANEL_SSH_OPTS ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            timeoutMs: Number(process.env.FASTPANEL_SSH_TIMEOUT_MS ?? 15_000),
        }
        : null;
    return {
        baseUrl,
        readToken,
        writeToken,
        insecureTls: process.env.FASTPANEL_INSECURE_TLS === "1",
        timeoutMs: Number(process.env.FASTPANEL_TIMEOUT_MS ?? 30_000),
        ssh,
    };
}
//# sourceMappingURL=config.js.map