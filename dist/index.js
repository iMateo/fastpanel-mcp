#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { FastPanelClient } from "./client.js";
import { SshClient } from "./ssh.js";
import { registerTools } from "./tools.js";
async function main() {
    const config = loadConfig();
    const client = new FastPanelClient(config);
    const ssh = new SshClient(config);
    const server = new McpServer({
        name: "fastpanel-mcp",
        version: "1.1.0",
    });
    registerTools(server, client, ssh);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const shutdown = async () => {
        await client.close();
        await server.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
main().catch((err) => {
    console.error("[fastpanel-mcp] fatal:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map