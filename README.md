# autosana-batch: wait for Autosana runs from any MCP client

Autosana's official MCP can start a run but cannot wait for it, and no tool takes a `batch_id`.
An agent has to loop on `list_flow_runs` and then read a full run record to learn the result.
This is a small MCP server that closes that gap: **start a run, block until it finishes, get a
short pass/fail answer.** It wraps Autosana's public REST API, so it works alongside the official MCP.

| Tool | What it does |
|---|---|
| `run_and_wait` | Start flows, suites or labels and wait for the verdict |
| `batch_status` | Status of any batch by `batch_id` (from the MCP, CLI or CI), optionally waiting |
| `run_details` | Why a run failed: summary, failing step, issues. Steps and URLs on request |

Full reference with real outputs: [docs/TOOLS.md](docs/TOOLS.md).

## Measured difference

Same task (run one flow, report pass/fail and why), same model, both sessions started from this
repo's root. Output of `node tools/autosana-batch-mcp/measure.ts <session>.jsonl` for each:

**Official Autosana MCP**


wall-clock: 244s | assistant output tokens: 799 | input tokens (incl. cache): 310444

| tool | calls | result chars | errors |
|---|---:|---:|---:|
| mcp__autosana__read_flow_run | 1 | 4109 | 0 |
| mcp__autosana__list_flow_runs | 2 | 777 | 0 |
| mcp__autosana__flows_run | 1 | 515 | 0 |
| ToolSearch | 1 | 0 | 0 |
| **total** | **5** | **5401** | **0** |


**autosana-batch**

wall-clock: 105s | assistant output tokens: 412 | input tokens (incl. cache): 144728

| tool | calls | result chars | errors |
|---|---:|---:|---:|
| mcp__autosana-batch__run_and_wait | 1 | 415 | 0 |
| ToolSearch | 1 | 0 | 0 |
| **total** | **2** | **415** | **0** |

One flow per arm, so treat it as the shape of the difference, not a benchmark.
Details and caveats: [docs/results.md](docs/results.md).

## Try it

Needs Node 22.18+ and an [Autosana API key](https://autosana.ai/settings?tab=api-keys).

```bash
cp .env.example .env           # put your key after AUTOSANA_KEY=
cd tools/autosana-batch-mcp
npm install
npm run check                  # confirms the key is accepted
claude mcp add autosana-batch -- node "$PWD/server.ts"
```

Then ask your agent to run a flow with the autosana-batch tools. The step-by-step comparison
is in [docs/demo.md](docs/demo.md).

## Layout

```
docs/                      tool reference, measured results, demo script
tools/autosana-batch-mcp/  the server (server.ts, api.ts) plus check, smoke and measure scripts
```

Session transcripts (`evidence/`) and early exploration notes (`archive/`) stay local and are git-ignored.

## Status

A prototype over the public API, not a change to Autosana's server. The proposal is to add
`batch_status` and a `wait` option to the official MCP; `hooks_run` and `pr_get_status` already
set that precedent.
