export interface SshConfig {
    host: string;
    port: number;
    user: string;
    key: string | null;
    extraOpts: string[];
    timeoutMs: number;
}
export interface Config {
    baseUrl: string;
    readToken: string;
    writeToken: string | null;
    insecureTls: boolean;
    timeoutMs: number;
    ssh: SshConfig | null;
    /** Opt-in local vault for mailbox passwords; null = passwords are never persisted. */
    passwordStore: "keychain" | null;
}
export declare function loadConfig(): Config;
