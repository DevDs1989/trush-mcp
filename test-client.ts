import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"]
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  console.log("Connecting to t-rush-mcp server...");
  await client.connect(transport);
  console.log("Connected!\n");

  console.log("--- Testing: scan_todos (scanning /home/dev/Desktop/openfoodfacts-explorer) ---");
  const scanResult = await client.callTool({
    name: "scan_todos",
    arguments: { cwd: "/home/dev/Desktop/openfoodfacts-explorer" }
  });
  console.log(scanResult.content[0].text);

  console.log("\n--- Testing: get_streak_status ---");
  const streakResult = await client.callTool({
    name: "get_streak_status",
    arguments: {}
  });
  console.log(streakResult.content[0].text);

  process.exit(0);
}

main().catch(console.error);
