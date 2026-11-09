# Demo script

Two fresh Claude Code sessions, same model, same prompt. Each starts **one real Autosana run** (uses credits).
Setup is in the [server README](../tools/autosana-batch-mcp/README.md).

## Before you start (no credits used)

```bash
cd tools/autosana-batch-mcp
npm run check                                   # key accepted?
node smoke.ts bc711d58-71a2-4610-90f7-178b44066f50 ca0e0eba-bcf4-49c3-8ec3-a0793e2615f0   # read-only: lists the 3 tools and calls them on a finished run
```

## A. Baseline: official MCP only

```bash
claude mcp remove autosana-batch    # skip if not registered
claude
```

```
Using only the Autosana MCP tools (no Bash, no CLI), run flow 2f6c7288-e347-4fe7-bde5-6054ce0fc96b on app
194f1bd7-ca63-429f-b2e5-1d30f0244a01, wait until it finishes, and tell me in two sentences whether it passed and why.
```

Watch for: which ID goes to `read_flow_run`, how the agent waits (repeated `list_flow_runs`?), and whether it picks the right run.

## B. With autosana-batch

```bash
claude mcp add autosana-batch -- node "$PWD/server.ts"     # from tools/autosana-batch-mcp
claude
```

Same prompt, with "Autosana MCP tools" replaced by "autosana-batch MCP tools". Expect one `run_and_wait` call.

## Measure

```bash
dirpath=~/.claude/projects/-mnt-c-Users-arush-Documents-Code-hackathon-autosana-poc    # your project's transcript folder
ls -t $dirpath/*.jsonl | head -2
node measure.ts $dirpath/<A-session-id>.jsonl --label "A: official MCP"
node measure.ts $dirpath/<B-session-id>.jsonl --label "B: autosana-batch"
```

`measure.ts` reports wall-clock, calls per tool, characters of tool output read back, errors and tokens.

## Optional: why not just use the CLI?

`autosana run --cloud --wait` does the same for scripts but needs a shell and the flow as a code-managed file in `.autosana/`
(docs: `code-managed-cli`). MCP-only clients (Claude Desktop, Cursor, cloud agents) have no shell to fall back on.
