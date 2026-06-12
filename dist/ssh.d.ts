import type { Config } from "./config.js";
export declare class SshDisabledError extends Error {
    constructor();
}
export interface SshResult {
    stdout: string;
    stderr: string;
    code: number;
}
/**
 * Runs commands on the FastPanel host via the local OpenSSH client. We shell out to
 * `ssh` (no library dependency) so the operator's existing key/agent/`~/.ssh/config`
 * is reused — nothing about a specific host is baked in; it all comes from config.
 */
export declare class SshClient {
    private readonly config;
    constructor(config: Config);
    get enabled(): boolean;
    private requireSsh;
    /** The shared connection options used by both direct ssh and rsync's `-e` remote shell. */
    private connectOpts;
    /** Build the argv for a direct `ssh` invocation running `remoteCommand` on the host. */
    private sshArgs;
    /**
     * Execute a single remote command. Returns stdout/stderr/exit code without throwing
     * on a non-zero exit (so callers can inspect failures, e.g. `nginx -t` errors). Only
     * a transport-level failure (ssh missing, connect timeout, auth refused) rejects.
     */
    exec(remoteCommand: string): Promise<SshResult>;
    /**
     * Push a local file or directory to the host. Uses `rsync` over the operator's ssh
     * (delta transfer, preserves nothing destructive by default), falling back to `scp -r`
     * if the local `rsync` binary is missing. `delete:true` mirrors the source (rsync only).
     * The bytes never pass through this process — rsync/scp stream them directly.
     */
    upload(localPath: string, remoteDest: string, opts?: {
        delete?: boolean;
    }): Promise<SshResult>;
    /** scp uses `-P` (capital) for the port; otherwise the same connection options. */
    private connectOptsForScp;
    /**
     * Write `content` to `remotePath` on the host by streaming it into `cat` over ssh.
     * For a single small file (the bytes DO pass through this process, so keep it small —
     * use upload() for anything large). Does not create parent dirs; mkdir -p first via exec().
     */
    putContent(content: Buffer, remotePath: string): Promise<SshResult>;
    /** execFile wrapper for transfer tools (rsync/scp): long timeout, surfaces ENOENT to the caller. */
    private run;
}
/** Single-quote a value for safe interpolation into a remote shell command. */
export declare function shq(value: string): string;
