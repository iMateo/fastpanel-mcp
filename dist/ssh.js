import { execFile, spawn } from "node:child_process";
export class SshDisabledError extends Error {
    constructor() {
        super("SSH operation attempted but SSH is not configured. Set FASTPANEL_SSH_HOST " +
            "(and optionally FASTPANEL_SSH_USER / FASTPANEL_SSH_PORT / FASTPANEL_SSH_KEY) to enable " +
            "host-level tools. SSH uses your machine's own `ssh` client, so the host must already be " +
            "reachable with key-based auth (BatchMode).");
        this.name = "SshDisabledError";
    }
}
/** File transfers can move many MB; give them a far longer ceiling than a command exec. */
const TRANSFER_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * Runs commands on the FastPanel host via the local OpenSSH client. We shell out to
 * `ssh` (no library dependency) so the operator's existing key/agent/`~/.ssh/config`
 * is reused — nothing about a specific host is baked in; it all comes from config.
 */
export class SshClient {
    config;
    constructor(config) {
        this.config = config;
    }
    get enabled() {
        return this.config.ssh !== null;
    }
    requireSsh() {
        const ssh = this.config.ssh;
        if (!ssh)
            throw new SshDisabledError();
        return ssh;
    }
    /** The shared connection options used by both direct ssh and rsync's `-e` remote shell. */
    connectOpts(ssh) {
        const opts = [
            "-p",
            String(ssh.port),
            "-o",
            "BatchMode=yes",
            "-o",
            `ConnectTimeout=${Math.max(1, Math.ceil(ssh.timeoutMs / 1000))}`,
            "-o",
            "StrictHostKeyChecking=accept-new",
        ];
        if (ssh.key)
            opts.push("-i", ssh.key);
        for (const o of ssh.extraOpts)
            opts.push("-o", o);
        return opts;
    }
    /** Build the argv for a direct `ssh` invocation running `remoteCommand` on the host. */
    sshArgs(ssh, remoteCommand) {
        return [...this.connectOpts(ssh), `${ssh.user}@${ssh.host}`, "--", remoteCommand];
    }
    /**
     * Execute a single remote command. Returns stdout/stderr/exit code without throwing
     * on a non-zero exit (so callers can inspect failures, e.g. `nginx -t` errors). Only
     * a transport-level failure (ssh missing, connect timeout, auth refused) rejects.
     */
    async exec(remoteCommand) {
        const ssh = this.requireSsh();
        const args = this.sshArgs(ssh, remoteCommand);
        return new Promise((resolve, reject) => {
            execFile("ssh", args, { timeout: ssh.timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
                const e = err;
                if (e && (e.code === "ENOENT" || e.killed)) {
                    // ssh binary not found, or local timeout killed the process.
                    return reject(new Error(e.code === "ENOENT"
                        ? "Local `ssh` client not found — install OpenSSH to use SSH-backed tools."
                        : `SSH command timed out after ${ssh.timeoutMs}ms`));
                }
                const code = typeof e?.code === "number" ? e.code : 0;
                resolve({ stdout: String(stdout), stderr: String(stderr), code });
            });
        });
    }
    /**
     * Push a local file or directory to the host. Uses `rsync` over the operator's ssh
     * (delta transfer, preserves nothing destructive by default), falling back to `scp -r`
     * if the local `rsync` binary is missing. `delete:true` mirrors the source (rsync only).
     * The bytes never pass through this process — rsync/scp stream them directly.
     */
    async upload(localPath, remoteDest, opts = {}) {
        const ssh = this.requireSsh();
        const remoteShell = ["ssh", ...this.connectOpts(ssh)].join(" ");
        const target = `${ssh.user}@${ssh.host}:${remoteDest}`;
        const rsyncArgs = ["-az", "--stats", "-e", remoteShell];
        if (opts.delete)
            rsyncArgs.push("--delete");
        rsyncArgs.push(localPath, target);
        try {
            return await this.run("rsync", rsyncArgs);
        }
        catch (err) {
            const e = err;
            if (e?.code !== "ENOENT")
                throw err;
            // No local rsync — fall back to scp. scp can't mirror-delete, so honour that.
            if (opts.delete) {
                throw new Error("delete:true needs rsync, but no local `rsync` was found. Install rsync, or upload without delete.");
            }
            const scpArgs = [...this.connectOptsForScp(ssh), "-r", localPath, target];
            return this.run("scp", scpArgs);
        }
    }
    /** scp uses `-P` (capital) for the port; otherwise the same connection options. */
    connectOptsForScp(ssh) {
        const opts = this.connectOpts(ssh);
        const i = opts.indexOf("-p");
        if (i >= 0)
            opts[i] = "-P";
        return opts;
    }
    /**
     * Write `content` to `remotePath` on the host by streaming it into `cat` over ssh.
     * For a single small file (the bytes DO pass through this process, so keep it small —
     * use upload() for anything large). Does not create parent dirs; mkdir -p first via exec().
     */
    async putContent(content, remotePath) {
        const ssh = this.requireSsh();
        const args = this.sshArgs(ssh, `cat > ${shq(remotePath)}`);
        return new Promise((resolve, reject) => {
            const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
            let stdout = "";
            let stderr = "";
            let settled = false;
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                child.kill("SIGKILL");
                reject(new Error(`SSH upload timed out after ${TRANSFER_TIMEOUT_MS}ms`));
            }, TRANSFER_TIMEOUT_MS);
            child.stdout.on("data", (d) => (stdout += d));
            child.stderr.on("data", (d) => (stderr += d));
            child.on("error", (err) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                const e = err;
                reject(e.code === "ENOENT"
                    ? new Error("Local `ssh` client not found — install OpenSSH to use SSH-backed tools.")
                    : err);
            });
            child.on("close", (code) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve({ stdout, stderr, code: code ?? 0 });
            });
            child.stdin.on("error", () => {
                /* broken pipe surfaces via 'close'/'error' above */
            });
            child.stdin.end(content);
        });
    }
    /** execFile wrapper for transfer tools (rsync/scp): long timeout, surfaces ENOENT to the caller. */
    run(cmd, args) {
        return new Promise((resolve, reject) => {
            execFile(cmd, args, { timeout: TRANSFER_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
                const e = err;
                if (e?.code === "ENOENT")
                    return reject(e); // let upload() decide on a fallback
                if (e?.killed)
                    return reject(new Error(`${cmd} timed out after ${TRANSFER_TIMEOUT_MS}ms`));
                const code = typeof e?.code === "number" ? e.code : 0;
                resolve({ stdout: String(stdout), stderr: String(stderr), code });
            });
        });
    }
}
/** Single-quote a value for safe interpolation into a remote shell command. */
export function shq(value) {
    return "'" + value.replace(/'/g, "'\\''") + "'";
}
//# sourceMappingURL=ssh.js.map