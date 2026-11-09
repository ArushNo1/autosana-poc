// Measure a Claude Code session transcript: tool calls, characters of tool output read back,
// errors, and wall-clock time. Used to compare "raw Autosana MCP" vs "autosana-batch" on the same task.
//
//   node measure.ts <session.jsonl> [--label "raw MCP"] [--json]
//
// Transcripts live in ~/.claude/projects/<project-dir>/<session-id>.jsonl (newest = most recent session).

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--label");
const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : file;
if (!file) {
  console.error('usage: node measure.ts <session.jsonl> [--label "name"] [--json]');
  process.exit(2);
}

type Block = { type: string; id?: string; name?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
const toolName = new Map<string, string>();
const perTool = new Map<string, { calls: number; chars: number; errors: number }>();
const seenMsg = new Set<string>();
let outputTokens = 0;
let inputTokens = 0;
let first: number | undefined;
let last: number | undefined;

const textOf = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => (x?.type === "text" ? x.text : "")).join("") : "";

for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let e: any;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  const msg = e.message;
  if (!msg || e.isSidechain) continue;
  const ts = e.timestamp ? Date.parse(e.timestamp) : undefined;
  if (ts) {
    first ??= ts;
    last = ts;
  }
  if (msg.role === "assistant" && msg.id && msg.usage && !seenMsg.has(msg.id)) {
    seenMsg.add(msg.id);
    outputTokens += msg.usage.output_tokens ?? 0;
    inputTokens += (msg.usage.input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
  }
  if (!Array.isArray(msg.content)) continue;
  for (const b of msg.content as Block[]) {
    if (b.type === "tool_use" && b.id && b.name) {
      toolName.set(b.id, b.name);
      const t = perTool.get(b.name) ?? { calls: 0, chars: 0, errors: 0 };
      t.calls++;
      perTool.set(b.name, t);
    } else if (b.type === "tool_result" && b.tool_use_id) {
      const t = perTool.get(toolName.get(b.tool_use_id) ?? "?");
      if (!t) continue;
      t.chars += textOf(b.content).length;
      if (b.is_error) t.errors++;
    }
  }
}

const rows = [...perTool.entries()].sort((a, b) => b[1].chars - a[1].chars);
const total = rows.reduce((s, [, t]) => ({ calls: s.calls + t.calls, chars: s.chars + t.chars, errors: s.errors + t.errors }), { calls: 0, chars: 0, errors: 0 });
const wall = first && last ? Math.round((last - first) / 1000) : 0;

if (args.includes("--json")) {
  console.log(JSON.stringify({ label, wall_s: wall, output_tokens: outputTokens, input_tokens_billed_or_cached: inputTokens, total, tools: Object.fromEntries(rows) }, null, 2));
} else {
  console.log(`# ${label}`);
  console.log(`wall-clock: ${wall}s | assistant output tokens: ${outputTokens} | input tokens (incl. cache): ${inputTokens}`);
  console.log(`\n| tool | calls | result chars | errors |\n|---|---:|---:|---:|`);
  for (const [n, t] of rows) console.log(`| ${n} | ${t.calls} | ${t.chars} | ${t.errors} |`);
  console.log(`| **total** | **${total.calls}** | **${total.chars}** | **${total.errors}** |`);
}
