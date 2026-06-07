import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastPanelClient } from "./client.js";
import type { SshClient } from "./ssh.js";
export declare function registerTools(server: McpServer, client: FastPanelClient, ssh: SshClient): void;
