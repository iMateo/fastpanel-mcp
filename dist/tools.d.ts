import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastPanelClient } from "./client.js";
import type { SshClient } from "./ssh.js";
import type { PasswordStore } from "./vault.js";
export declare function registerTools(server: McpServer, client: FastPanelClient, ssh: SshClient, vault: PasswordStore): void;
