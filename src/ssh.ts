import { execFile } from "node:child_process";
import type { Config } from "./config.js";

export class SshDisabledError extends Error {
  constructor() {
    super(
      "SSH operation attempted but SSH is not configured. Set FASTPANEL_SSH_HOST " +
        "(and optionally FASTPANEL_SSH_USER / FASTPANEL_SSH_PORT / FASTPANEL_SSH_KEY) to enable " +
        "host-level tools. SSH uses your machine's own `ssh` client, so the host must already be " +
        "reachable with key-based auth (BatchMode).",
    );
    this.name = "SshDisabledError";
  }
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
export class SshClient {
  constructor(private readonly config: Config) {}

  get enabled(): boolean {
    return this.config.ssh !== null;
  }

  /**
   * Execute a single remote command. Returns stdout/stderr/exit code without throwing
   * on a non-zero exit (so callers can inspect failures, e.g. `nginx -t` errors). Only
   * a transport-level failure (ssh missing, connect timeout, auth refused) rejects.
   */
  async exec(remoteCommand: string): Promise<SshResult> {
    const ssh = this.config.ssh;
    if (!ssh) throw new SshDisabledError();

    const args: string[] = [
      "-p",
      String(ssh.port),
      "-o",
      "BatchMode=yes",
      "-o",
      `ConnectTimeout=${Math.max(1, Math.ceil(ssh.timeoutMs / 1000))}`,
      "-o",
      "StrictHostKeyChecking=accept-new",
    ];
    if (ssh.key) args.push("-i", ssh.key);
    for (const o of ssh.extraOpts) args.push("-o", o);
    args.push(`${ssh.user}@${ssh.host}`, "--", remoteCommand);

    return new Promise<SshResult>((resolve, reject) => {
      execFile(
        "ssh",
        args,
        { timeout: ssh.timeoutMs, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          if (e && (e.code === "ENOENT" || e.killed)) {
            // ssh binary not found, or local timeout killed the process.
            return reject(
              new Error(
                e.code === "ENOENT"
                  ? "Local `ssh` client not found — install OpenSSH to use SSH-backed tools."
                  : `SSH command timed out after ${ssh.timeoutMs}ms`,
              ),
            );
          }
          const code = typeof e?.code === "number" ? e.code : 0;
          resolve({ stdout: String(stdout), stderr: String(stderr), code });
        },
      );
    });
  }
}

/** Single-quote a value for safe interpolation into a remote shell command. */
export function shq(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
