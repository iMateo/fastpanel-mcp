import { spawn } from "node:child_process";
import type { Config } from "./config.js";

export class PasswordStoreDisabledError extends Error {
  constructor() {
    super(
      "Password store is not configured. Set FASTPANEL_PASSWORD_STORE=keychain (macOS only) to have " +
        "mailbox_create / mailbox_update save mailbox passwords to the login Keychain and to enable mailbox_password_get.",
    );
    this.name = "PasswordStoreDisabledError";
  }
}

function run(cmd: string, args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

const SECURITY = "/usr/bin/security";
// Keychain attributes travel through `security -i`, whose line parser understands double quotes
// but has no reliable escaping — so anything interpolated there must match this.
const SAFE_ATTR = /^[A-Za-z0-9@._:+-]+$/;

/**
 * Opt-in local vault for mailbox passwords. FastPanel never reveals a mailbox password through
 * its API or CLI, so the moment a password is set is the only time it can be captured; this stores it in the operator's macOS
 * login Keychain (via the system `security` CLI — no dependency), keyed by panel host + address.
 *
 * Secrets never appear in argv: writes go through `security -i` on stdin, hex-encoded (-X), so
 * no quoting of the password is ever needed. Nothing here is logged.
 */
export class PasswordStore {
  readonly kind: "keychain" | null;
  private readonly service: string;

  constructor(config: Config) {
    this.kind = config.passwordStore;
    let host = "panel";
    try {
      host = new URL(config.baseUrl).host;
    } catch {
      /* keep fallback */
    }
    this.service = `fastpanel-mcp:${host}`.replace(/[^A-Za-z0-9@._:+-]/g, "_");
  }

  get enabled(): boolean {
    return this.kind !== null;
  }

  private assertUsable(address: string): void {
    if (!this.enabled) throw new PasswordStoreDisabledError();
    if (process.platform !== "darwin") {
      throw new Error("FASTPANEL_PASSWORD_STORE=keychain is only supported on macOS (uses /usr/bin/security).");
    }
    if (!SAFE_ATTR.test(address)) throw new Error(`Unsupported characters in mailbox address: ${address}`);
  }

  /** Create or overwrite the stored password for a mailbox address. */
  async save(address: string, password: string): Promise<void> {
    this.assertUsable(address);
    const hex = Buffer.from(password, "utf8").toString("hex");
    const cmd =
      `add-generic-password -U -s "${this.service}" -a "${address}" ` +
      `-l "FastPanel mailbox ${address}" -D "mailbox password" -X ${hex}\n`;
    const r = await run(SECURITY, ["-i"], cmd);
    if (r.code !== 0 || /error|could not|failed/i.test(r.stderr)) {
      throw new Error(`Keychain write failed (exit ${r.code}): ${r.stderr.trim() || "unknown error"}`);
    }
  }

  /** Stored password, or null when there is no entry for this address. */
  async get(address: string): Promise<string | null> {
    this.assertUsable(address);
    const r = await run(SECURITY, ["find-generic-password", "-s", this.service, "-a", address, "-w"]);
    if (r.code === 44) return null;
    if (r.code !== 0) throw new Error(`Keychain read failed (exit ${r.code}): ${r.stderr.trim()}`);
    return r.stdout.replace(/\n$/, "");
  }

  /** Whether an entry exists — does not read the secret. */
  async has(address: string): Promise<boolean> {
    this.assertUsable(address);
    const r = await run(SECURITY, ["find-generic-password", "-s", this.service, "-a", address]);
    return r.code === 0;
  }

  describe(): string {
    return `macOS Keychain (service "${this.service}")`;
  }
}
