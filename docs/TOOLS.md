# autosana-batch: tool reference

Three tools that let an agent start Autosana runs, wait for them, and read the result in a few
lines. They wrap Autosana's public REST API and work in any MCP client, including ones with no shell.

| Tool | Use it to | Cost to the agent |
|---|---|---|
| [`run_and_wait`](#run_and_wait) | Start flows, suites or labels and block until they finish | 1 call, ~400 chars |
| [`batch_status`](#batch_status) | Check, or wait on, any batch by `batch_id` | 1 call, ~400 chars |
| [`run_details`](#run_details) | Find out why one run failed | 1 call, ~400 chars (more on request) |

Every reply starts with a `RESULT:` line (`PASSED`, `FAILED`, `RUNNING`, `TIMEOUT`, `STARTED`, or the
run's own status), so an agent or a `grep` gets the verdict without parsing anything.

## The typical loop

```
run_and_wait(flow_ids=[...])  ->  RESULT: PASSED        done, 1 call
                              ->  RESULT: FAILED        run_details(run_id)  ->  failing step + reviewer summary
                              ->  RESULT: TIMEOUT       batch_status(batch_id, wait=true)
```

## run_and_wait

Starts a run and, by default, blocks until the whole batch finishes.

| Argument | Notes |
|---|---|
| `app_id` | Web app: UUID or slug (a UUID is mapped to its slug for you). Mobile: pass `bundle_id` + `platform` instead |
| `flow_ids`, `suite_ids`, `labels` | At least one is required. Labels run everything carrying any of them |
| `wait` | Default `true`. `false` returns `RESULT: STARTED` plus the `batch_id` straight away |
| `timeout_s` / `poll_s` | Default 600 s / 10 s (the API docs recommend 10-15 s) |
| `resolve_suite_context`, `environment_variables`, `web_browser` | Passed through to the API |

Real output (a 1-flow run, 14 s end to end, 2 status checks):

```
RESULT: PASSED (1/1 passed) after 11s
batch_id: acc14013-5d63-4286-aa4d-a5c5a3ef04cc
batch_url: https://autosana.ai/runs/batches/acc14013-5d63-4286-aa4d-a5c5a3ef04cc
- [passed] Auth | Signed-out visitor is sent to login  run_id=...
    The signed-out home page loaded, and selecting Problems led to the Login page ...
```

On failure the last line is `Next: call run_details with a failed run_id for the failing step.`
On timeout the run keeps going; the reply says to call `batch_status` with `wait=true`.

## batch_status

Status of every flow in a batch. Accepts a `batch_id` from anywhere: the official MCP's `flows_run` /
`suites_run` / `labels_run`, the `autosana` CLI, CI, or `run_and_wait`. This is the tool the official MCP
does not have: none of its tools take a `batch_id`.

| Argument | Notes |
|---|---|
| `batch_id` | UUID |
| `wait` | Default `false` (one look). `true` blocks until the batch finishes or `timeout_s` passes |
| `timeout_s` / `poll_s` | As above |

Real output:

```
RESULT: PASSED (1/1 passed)
batch_id: bc711d58-71a2-4610-90f7-178b44066f50
batch_url: https://autosana.ai/runs/batches/bc711d58-71a2-4610-90f7-178b44066f50
- [passed] Auth | Signed-out visitor is sent to login  run_id=ca0e0eba-bcf4-49c3-8ec3-a0793e2615f0
    The signed-out home page loaded, and selecting Problems led to the Login page with Email and Password fields. ...
```

An unknown batch returns `ERROR: HTTP 404 ... Batch not found` with `isError` set.

## run_details

A compact answer to "why did this run pass or fail?".

| Argument | Notes |
|---|---|
| `run_id` | The `run_id` printed by `run_and_wait` / `batch_status` |
| `include_actions` | Default `false`. `true` lists every step |
| `include_urls` | Default `false`. `true` adds screenshot, recording, device-log, network-log and performance URLs (signed, expire in 24 h) |

Default output:

```
RESULT: PASSED  Auth | Signed-out visitor is sent to login  (web, 22s, 2 actions)
url: https://autosana.ai/runs/flow/ca0e0eba-bcf4-49c3-8ec3-a0793e2615f0
summary: The signed-out home page loaded, and selecting Problems led to the Login page ...
(pass include_actions / include_urls for steps, screenshots, recording and logs)
```

For a non-passing run it also prints `failing_step:` (or `last_step:`), `failing_hook:` and one
`issue [severity type]:` line per reported issue. The same run with steps and signed URLs is 2,521
chars, about 6x the default, which is why they are opt-in.

## Behaviour that matters in a demo

- **Waiting is the server's job.** It polls `/runs/status` until `is_complete`, so the agent spends one
  call instead of a loop of its own.
- **Progress for clients that want it.** If the client sends a progress token, the server emits
  `n/m flows finished, Ns` notifications while it waits.
- **Resilient.** 429 and 5xx responses are retried (up to 5 in a row); client cancellation stops the wait.
- **Safe.** The API key is read from the environment or `.env` and is never printed or returned to the agent.
- **Auditable.** Each call appends one line (tool, args, ms, chars; no secrets) to `logs/calls.jsonl`.

## How it maps to the official MCP

| Need | Official MCP today | autosana-batch |
|---|---|---|
| Block until a run finishes | none (`flows_run` says to poll `list_flow_runs`) | `run_and_wait`, `batch_status(wait=true)` |
| Look up results by batch | no tool takes `batch_id` | `batch_status` |
| Short per-run summary | `read_flow_run` returns the full record | `run_details` (steps and URLs opt-in) |

Already precedented in the official server: `hooks_run` waits and `pr_get_status` reports PR runs. The
proposal is to bring the same to flow, suite and label runs.
