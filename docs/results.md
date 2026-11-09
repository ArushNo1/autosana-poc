# Measured results

Same task in two fresh Claude Code sessions: run one 2-action web flow and report whether it passed and why.
Figures come from `tools/autosana-batch-mcp/measure.ts` run on each session's transcript.

| | A: official MCP | B: autosana-batch |
|---|---:|---:|
| Wall-clock for the whole session | 244 s | 105 s |
| Tool calls | 4 | 1 |
| Tool output read back (chars) | 5,401 | 415 |
| Input tokens (incl. cache) | 310,444 | 144,728 |
| Assistant output tokens | 799 | 412 |
| Errors | 0 | 0 |

Both sessions started from the repo root, same prompt. The transcripts are kept locally in `evidence/` (git-ignored: they contain
prompts, local paths and signed URLs); the raw `measure.ts` output for each is in the [root README](../README.md#measured-difference).

Tool calls in A: `flows_run`, `list_flow_runs` x2, `read_flow_run` (plus one `ToolSearch` to load the tools, which B also needed).
Tool calls in B: `run_and_wait` (plus the same `ToolSearch`).

Inside B, the server itself took about 14 s per run (`logs/calls.jsonl`: 2 status checks, 11-12 s waited); the rest of the 105 s is the
model loading tools and answering.

## Read this with care

- One flow, one run per arm. This shows the shape of the difference, not a benchmark.
- Much of A's wall-clock is the agent's own turn latency between status checks, since the official MCP gives it nothing to wait on.
- The sessions used Claude Code as the client, which is the main use case for an MCP server.

## Reproduce

See [demo.md](demo.md).
