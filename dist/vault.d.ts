import type { Config } from "./config.js";
export declare class PasswordStoreDisabledError extends Error {
    constructor();
}
/**
 * Opt-in local vault for mailbox passwords. FastPanel never reveals a mailbox password through
 * its API or CLI, so the moment a password is set is the only time it can be captured; this stores it in the operator's macOS
 * login Keychain (via the system `security` CLI — no dependency), keyed by panel host + address.
 *
 * Secrets never appear in argv: writes go through `security -i` on stdin, hex-encoded (-X), so
 * no quoting of the password is ever needed. Nothing here is logged.
 */
export declare class PasswordStore {
    readonly kind: "keychain" | null;
    private readonly service;
    constructor(config: Config);
    get enabled(): boolean;
    private assertUsable;
    /** Create or overwrite the stored password for a mailbox address. */
    save(address: string, password: string): Promise<void>;
    /** Stored password, or null when there is no entry for this address. */
    get(address: string): Promise<string | null>;
    /** Whether an entry exists — does not read the secret. */
    has(address: string): Promise<boolean>;
    describe(): string;
}
