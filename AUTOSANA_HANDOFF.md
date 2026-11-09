# Autosana handoff (paste into a fresh Claude Code session)

Goal: Arush wants to pitch something to someone at Autosana (AI E2E testing platform).
He wants a working demo of a real improvement, backed by evidence HE collected and can
reproduce, not by "Claude said so". He wants to run things himself; keep MCP/tool use
minimal and have him do the clicking. Never print .env values.

## What exists (non-secret IDs)

- MCP server: `https://mcp.autosana.ai/mcp` (OAuth, added via `claude mcp add --transport http autosana ...`)
- REST API (from docs, NOT yet called by us): base `https://backend.autosana.ai`, header `X-API-Key`.
  POST `/api/v1/flows/run`, GET `/api/v1/runs/status?batch_id=`, GET `/api/v1/runs/{run_id}`, POST `/api/v1/runs/terminate`.
  Docs recommend polling every 10-15 s until `is_complete`.
- Autosana apps: ACL Online Judge `194f1bd7-ca63-429f-b2e5-1d30f0244a01` (https://acl-oj.vercel.app);
  Lab calm `382c82ea-df15-4457-b5e9-ff57a57af03b`; Lab chaos `cc55b396-63a3-436a-866a-4676a502c932`
- Flow (2 actions, passed, 22 s): `2f6c7288-e347-4fe7-bde5-6054ce0fc96b`. Its run `ca0e0eba-bcf4-49c3-8ec3-a0793e2615f0`,
  batch `bc711d58-71a2-4610-90f7-178b44066f50`, group `d73101fa-fe5e-4dd5-b5b4-b4f3b41de89f`
- A lab flow "Lab | L1 Submit Problem A" MAY exist (a subagent created it before it died). Check `flows_list`.
- Env vars in the Staging env (`4360ead7-57a0-4d84-92cb-0f678b5b694f`): `bot_email`, `bot_password` (secret). Test account is non-admin.
- Repo: branch `flake-lab` (commit 4ba758d) adds a dormant `/lab` test page (see FLAKE_LAB.md). Vercel project `acl-oj-lab`
  serves it publicly at https://acl-oj-lab.vercel.app/lab. `flake-results/` may hold partial output; nothing there is committed.
- `.env` var names: AUTOSANA_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, `new-supabse-publishable`,
  `new-supabse-secret-key` (hyphens + typo; not shell-sourceable).
- The lab experiments (flakiness runs) were abandoned: the toy app was too simple and the runs never completed. No flakiness data exists.

## Observations about the Autosana MCP (from Claude's side as the calling agent)

Status: OBSERVED = seen in a tool output this session. UNMEASURED = estimated by eye. UNVERIFIED = from docs index or inference.

| # | Observation | Status | How to verify yourself |
|---|---|---|---|
| 1 | `read_flow_run` returns one long text blob: metadata, 3 signed log/perf URLs, instructions, review, then every action with 1-2 screenshot URLs each. Length grows with action count. | OBSERVED shape; size UNMEASURED | Save the output to a file; `wc -c`; `grep -oE 'https://[^ )]+' file \| wc -c` for URL share. Do it for a 2-action run and a 20-action run. |
| 2 | No blocking wait for a run. Agent must poll `list_flow_runs`. The onboarding text itself says poll every 30 s. | OBSERVED (MCP). CLI/REST behavior UNVERIFIED | Read docs `install-cli`, `code-managed-cli`, `api-runs`; check if the CLI already waits. |
| 3 | Three ID kinds after `flows_run`: group run id, flow run ids, batch id. `list_flow_runs` prints "Run ID"; `read_flow_run` requires `flow_run_id` and rejects `run_id`. REST status takes `batch_id`. | OBSERVED | Call each tool once and note which id goes where. |
| 4 | Status lines contain the word "Completed: None" while running, which broke a naive `grep -i completed` poll loop. | OBSERVED (our bug, but a format papercut) | Poll a running flow and print raw output. |
| 5 | Review block says "Confidence: 7" with no stated scale. | OBSERVED; scale UNVERIFIED | Search docs. |
| 6 | Secret env var tool requires an explicit consent flag and masks values afterward. | OBSERVED, a good design | n/a |
| 7 | Docs index has no page on flaky-test handling, trends/analytics, visual regression, accessibility. | UNVERIFIED (titles only, pages not read) | Read `automations`, `api-runs`, `notifications` fully before claiming a gap. |
| 8 | Per the docs, REST has no "list all runs" endpoint; runs are found via `batch_id`, while MCP has `list_flow_runs`. | UNVERIFIED (from a fetch agent's summary) | Read `api-runs.md` yourself and call the API. |

### Correction to earlier claims
Claude earlier said each signed URL was "roughly 400 characters" and that results "flood" an agent's context. Both were eyeballed,
not measured, and "flood" was overstated for a 2-action run. Arush noticed the URLs seemed shorter and that multi-flow output is the
long one. Treat #1 as a hypothesis to measure, not a finding.

## Candidate demo: compact, waitable run results for agents

Idea: a small CLI (and/or thin MCP proxy) over the REST API:
- `wait <batch_id>`: poll `/runs/status` every 10-15 s, exit 0/1 on pass/fail, print one line.
- `summary <run_id>`: status, duration, failing step, reviewer justification, dashboard link. `--full` for everything; signed URLs only on request.
- Accept any of the run/group/batch ids.

How it demos: same task ("run this flow and tell me whether it passed and why") done by Claude Code twice: once via raw Autosana MCP,
once via the wrapper. Show a table: tool calls, characters/tokens read, wall-clock, number of retries/errors. The numbers come from
logs Arush captures, not from Claude's opinion.

BIGGEST RISK: Autosana may already have this (the `autosana` CLI, code-managed-cli docs). First step is reading those docs and trying the CLI.
If it exists, the angle changes to "MCP vs CLI parity" or something else found while measuring.

## Evidence plan (so the pitch rests on Arush's own work)

1. Capture raw outputs of each MCP tool for a short run and a long run into files (dated). Measure sizes with the commands above.
2. Do the same task via MCP, REST (curl with an API key from https://autosana.ai/settings?tab=api-keys), and the CLI. Count calls, bytes, seconds.
3. Keep a dated log: finding, exact steps, raw file path, and what he expected.
4. Be upfront in the pitch that Claude Code was the agent client. That is the use case an MCP server targets, and the observations come from that side.

## Environment gotchas

- Windows + Git Bash/PowerShell. The permission classifier blocked a command that extracted key prefixes from `.env`; names-only listing works.
- `npx mcporter@latest call 'https://mcp.autosana.ai/mcp.<tool>' key=value` calls MCP tools from a shell (token cache: ~/.mcporter/credentials.json, do not share).
- Project rules (CLAUDE.md): Tailwind classes only; `oj-*` color tokens; no `style={}` for static values.
- A subagent died with "safeguards flagged this message" (not an Autosana issue). Long unattended subagent runs are fragile; prefer short, checkpointed tasks.

## Cleanup still open

Check https://autosana.ai/runs for stray runs. Vercel project `acl-oj-lab` is public. Test account password is weak. Branch `flake-lab` is on GitHub.
