// Smoke test: talks to server.ts over stdio like an MCP client would. Read-only calls only.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [batchId, runId] = process.argv.slice(2);
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["server.ts"] }));
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const show = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args });
  const text = r.content.map((c: any) => c.text).join("");
  console.log(`\n=== ${name} ${JSON.stringify(args)} -> ${text.length} chars${r.isError ? " (isError)" : ""}\n${text}`);
};
if (batchId) await show("batch_status", { batch_id: batchId });
if (runId) {
  await show("run_details", { run_id: runId });
  await show("run_details", { run_id: runId, include_actions: true, include_urls: true });
}
await show("batch_status", { batch_id: "00000000-0000-4000-8000-000000000000" });
await client.close();
