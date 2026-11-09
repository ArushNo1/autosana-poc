# autosana-batch-mcp

MCP server (stdio) with three tools: `run_and_wait`, `batch_status`, `run_details`.
Overview and measured results are in the [repo README](../../README.md); tool reference is in
[docs/TOOLS.md](../../docs/TOOLS.md).

## Setup

```bash
npm install
npm run check          # prints only the HTTP status: "OK: REST API accepted the key ..."
```

Needs Node 22.18+ (runs `.ts` directly).

API key lookup order: `AUTOSANA_API_KEY`, then `AUTOSANA_KEY`, then `AUTOSANA_KEY=` in the repo-root `.env`
(see `.env.example`; override the file with `AUTOSANA_ENV_FILE`). The key is never printed or returned to the agent.
`AUTOSANA_BASE_URL` overrides the API host (default `https://backend.autosana.ai`).

## Register with Claude Code

```bash
claude mcp add autosana-batch -- node "$PWD/server.ts"     # run from this folder
claude mcp list                                            # should show autosana-batch: connected
claude mcp remove autosana-batch                           # to undo
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run check` | Verify the API key (one request) |
| `node smoke.ts [batch_id] [run_id]` | Start the server over stdio and call the read-only tools; starts no runs |
| `node measure.ts <session.jsonl> --label "..."` | Count calls, output chars, errors and tokens in a Claude Code transcript |

Smoke test against the known finished run:

```bash
node smoke.ts bc711d58-71a2-4610-90f7-178b44066f50 ca0e0eba-bcf4-49c3-8ec3-a0793e2615f0
```

## Files

- `server.ts`: tool definitions and the wait loop (progress notifications, retry on 429/5xx, cancellation)
- `api.ts`: REST client, key loading, output formatting (`RESULT:` line first), call log
- `logs/calls.jsonl`: one line per call (tool, args, ms, chars; no secrets); git-ignored

## Limits

- Prototype over the public REST API; it does not change Autosana's server.
- `run_and_wait` has run live against a real flow (about 14 s end to end), `batch_status` and `run_details` against a finished batch. Only one short web flow has been tried: no suites, labels, mobile or long runs yet.
