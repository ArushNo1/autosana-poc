# autosana-batch-mcp (prototype)

A small MCP server that gives agents what `autosana run --wait` gives scripts: start a run,
**block until it finishes**, and get a **short pass/fail answer keyed by `batch_id`**.
It wraps Autosana's public REST API (`/api/v1/flows/run`, `/runs/status`, `/runs/{id}`).

## Why (the gap, from Autosana's own docs and tool schemas, checked 2026-11-08)

| | CLI | REST | Official MCP |
|---|---|---|---|
| Block until a run finishes | `autosana run --wait` (exit 0/1) | poll `/runs/status` | none; `flows_run` says "use list_flow_runs to check status" |
| Results by batch id | prints `batch <id>` | `/runs/status?batch_id=` | no tool takes a `batch_id`; `list_flow_runs` filters by flow/date only |
| Short per-run summary | one line per flow | `runs[].summary` | `read_flow_run` always returns the full record |

Precedent inside the official MCP: `hooks_run` already waits, and PR runs have `pr_get_status`.
MCP-only agents (Claude Desktop, Cursor, cloud agents without a shell) can't fall back to the CLI.

## Tools

| Tool | What it returns |
|---|---|
| `run_and_wait(app_id, flow_ids \| suite_ids \| labels, wait=true, timeout_s=600)` | `RESULT: PASSED/FAILED/TIMEOUT (n/m passed) after Ns`, `batch_id`, one line per flow with `run_id` + reviewer summary |
| `batch_status(batch_id, wait=false)` | same format; `RUNNING` while in progress. Works on batches from the official MCP, the CLI or CI too |
| `run_details(run_id, include_actions=false, include_urls=false)` | status, duration, summary, failing step/hook, issues. Steps and signed URLs only on request |

The first line always starts with `RESULT:`, so a model or a `grep` can read the verdict without parsing.
While waiting it sends MCP progress notifications (if the client asks for them), retries 429/5xx up to
5 times in a row, and stops when the client cancels. Each call appends one line (tool, args, ms, chars;
no secrets) to `logs/calls.jsonl`.

## Setup

```bash
cd tools/autosana-batch-mcp
npm install
npm run check          # prints only the HTTP status: "OK: REST API accepted the key ..."
```

The API key comes from `AUTOSANA_API_KEY`, else `AUTOSANA_KEY`, else `AUTOSANA_KEY=` in the repo's `.env`
(override with `AUTOSANA_ENV_FILE`). It is never printed or returned to the agent. Needs Node 22.18+ (runs `.ts` directly).

Register it with Claude Code (local scope, this project only):

```bash
claude mcp add autosana-batch -- node "C:/Users/arush/Documents/Code/React/acl-online-judge/tools/autosana-batch-mcp/server.ts"
claude mcp list        # should show autosana-batch: connected
```

Remove with `claude mcp remove autosana-batch`.

Read-only smoke test without an MCP client (uses the existing passed batch, starts nothing):

```bash
node smoke.ts bc711d58-71a2-4610-90f7-178b44066f50 ca0e0eba-bcf4-49c3-8ec3-a0793e2615f0
```

## Demo protocol (evidence you collect yourself)

Same task, two fresh Claude Code sessions, same model. Each starts **one real run** (credits).

**A. Baseline, official MCP only.** Make sure `autosana-batch` is *not* registered (`claude mcp remove autosana-batch`),
start `claude`, paste:

> Using only the Autosana MCP tools (no Bash, no CLI), run flow 2f6c7288-e347-4fe7-bde5-6054ce0fc96b on app
> 194f1bd7-ca63-429f-b2e5-1d30f0244a01, wait until it finishes, and tell me in two sentences whether it passed and why.

**B. With the prototype.** Register `autosana-batch` (command above), start a new `claude`, paste the same prompt with
"Autosana MCP tools" replaced by "autosana-batch MCP tools".

**Measure both** (each session's transcript is the newest `.jsonl` in the project folder right after it ends):

```bash
ls -t ~/.claude/projects/C--Users-arush-Documents-Code-React-acl-online-judge/*.jsonl | head -2
node measure.ts <A.jsonl> --label "A: official MCP"
node measure.ts <B.jsonl> --label "B: autosana-batch"
```

`measure.ts` reports wall-clock, tool calls per tool, characters of tool output read back, errors, and tokens.
Save both outputs plus the two run links in a dated log. Record what you expected before each run.

Things to watch for in A (from the handoff, not yet measured): which ID the agent passes to `read_flow_run`,
how it waits (repeated `list_flow_runs`? a Bash `sleep`?), and whether it picks the right run if older runs exist.

**Optional C. CLI.** `autosana run --cloud --wait` needs the flow as a code-managed file in `.autosana/`
(see docs `code-managed-cli`). Worth showing because Autosana will ask "why not just shell out?"; the answer is
MCP-only clients.

## Honest limits

- A prototype over the public API, not a change to Autosana's server. The pitch is "add `batch_status` /
  a `wait` option to the official MCP"; this shows the shape and the measured difference.
- `run_and_wait` has been type-checked but not yet run live (that costs a run). `batch_status` and `run_details`
  were tested against a real batch/run on 2026-11-08.
- One 2-action flow is a small sample. Add a longer flow or a suite for a second data point.
