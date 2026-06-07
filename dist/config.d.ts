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
}
export declare function loadConfig(): Config;
