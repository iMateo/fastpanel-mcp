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
    /**
     * Execute a single remote command. Returns stdout/stderr/exit code without throwing
     * on a non-zero exit (so callers can inspect failures, e.g. `nginx -t` errors). Only
     * a transport-level failure (ssh missing, connect timeout, auth refused) rejects.
     */
    exec(remoteCommand: string): Promise<SshResult>;
}
/** Single-quote a value for safe interpolation into a remote shell command. */
export declare function shq(value: string): string;
