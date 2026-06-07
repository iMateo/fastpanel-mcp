import type { Config } from "./config.js";
export declare class FastPanelError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown);
}
export declare class FastPanelWriteDisabledError extends Error {
    constructor();
}
export declare class FastPanelClient {
    private readonly config;
    private readonly dispatcher;
    constructor(config: Config);
    get hasWriteToken(): boolean;
    get<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
    post<T = unknown>(path: string, body?: unknown): Promise<T>;
    patch<T = unknown>(path: string, body?: unknown): Promise<T>;
    put<T = unknown>(path: string, body?: unknown): Promise<T>;
    delete<T = unknown>(path: string): Promise<T>;
    private request;
    close(): Promise<void>;
}
