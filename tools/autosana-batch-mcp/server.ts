#!/usr/bin/env node
// Prototype MCP server that gives agents what the Autosana CLI's `run --wait` gives scripts:
// start a run, block until it finishes, and get a short pass/fail answer, keyed by batch_id.
//
// Tools:
//   run_and_wait  - POST /api/v1/flows/run, then wait on the batch (optional)
//   batch_status  - GET  /api/v1/runs/status?batch_id=..., optionally waiting until complete
//   run_details   - GET  /api/v1/runs/{run_id}, compact by default; steps/URLs opt-in

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  api,
  ApiError,
  formatBatch,
  formatRun,
  logCall,
  type BatchStatus,
  type RunDetails,
  type RunStart,
} from "./api.ts";

const server = new McpServer({ name: "autosana-batch", version: "0.1.0" });

type Extra = {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification: (n: { method: "notifications/progress"; params: Record<string, unknown> }) => Promise<void>;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), res()), { once: true });
  });

/** Poll run status until is_complete, the timeout, or the client cancels. Transient errors are retried. */
async function waitForBatch(batchId: string, timeoutS: number, pollS: number, extra: Extra) {
  const started = Date.now();
  let polls = 0;
  let consecutiveErrors = 0;
  let last: BatchStatus | undefined;
  for (;;) {
    try {
      last = await api<BatchStatus>("GET", `/api/v1/runs/status?batch_id=${encodeURIComponent(batchId)}`);
      polls++;
      consecutiveErrors = 0;
    } catch (e) {
      const transient = e instanceof ApiError ? e.status === 429 || e.status >= 500 : true;
      if (!transient || ++consecutiveErrors >= 5) throw e;
    }
    const waited = Math.round((Date.now() - started) / 1000);
    if (last?.is_complete) return { status: last, waited, polls, timedOut: false };
    if (waited >= timeoutS || extra.signal.aborted) {
      if (!last) throw new Error(`No status for batch ${batchId} within ${timeoutS}s`);
      return { status: last, waited, polls, timedOut: true };
    }
    // Progress notifications keep long calls alive in clients that reset their timeout on progress.
    const token = extra._meta?.progressToken;
    if (token !== undefined && last) {
      const s = last.summary;
      const done = s.passed_flows + s.failed_flows + s.error_flows + s.terminated_flows + s.skipped_flows;
      await extra
        .sendNotification({
          method: "notifications/progress",
          params: { progressToken: token, progress: done, total: s.total_flows, message: `${done}/${s.total_flows} flows finished, ${waited}s` },
        })
        .catch(() => {});
    }
    await sleep(pollS * 1000, extra.signal);
  }
}

/** Wrap a handler: uniform error text, plus one evidence-log line per call. */
function tool<A>(name: string, fn: (args: A, extra: Extra) => Promise<{ text: string; meta?: Record<string, unknown> }>) {
  return async (args: A, extra: unknown) => {
    const t0 = Date.now();
    try {
      const { text, meta } = await fn(args, extra as Extra);
      logCall({ tool: name, args, ok: true, ms: Date.now() - t0, chars: text.length, ...meta });
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint =
        e instanceof ApiError && e.status === 401
          ? " (API key rejected: create one at https://autosana.ai/settings?tab=api-keys)"
          : e instanceof ApiError && e.code
            ? ` (X-Autosana-Error: ${e.code})`
            : "";
      const text = `ERROR: ${msg}${hint}`;
      logCall({ tool: name, args, ok: false, ms: Date.now() - t0, chars: text.length });
      return { content: [{ type: "text" as const, text }], isError: true };
    }
  };
}

const uuid = z.string().uuid();
const timeoutField = z.number().int().min(10).max(3600).default(600).describe("Max seconds to wait (default 600).");
const pollField = z.number().int().min(5).max(60).default(10).describe("Seconds between status checks (default 10; docs recommend 10-15).");

server.registerTool(
  "run_and_wait",
  {
    title: "Run flows and wait for the result",
    description:
      "Start Autosana flows and/or suites and, by default, block until they finish. Returns one RESULT line " +
      "(PASSED / FAILED / TIMEOUT), the batch_id, and one line per flow with its run_id and the reviewer's summary. " +
      "Use run_details on a failed run_id to see the failing step. If it times out, call batch_status with the batch_id.",
    inputSchema: {
      app_id: z.string().describe("Web app id (UUID or slug). For mobile apps pass bundle_id + platform instead."),
      bundle_id: z.string().optional().describe("Mobile bundle id (with platform)."),
      platform: z.enum(["ios", "android"]).optional(),
      flow_ids: z.array(uuid).optional(),
      suite_ids: z.array(uuid).optional(),
      labels: z.array(z.string()).optional().describe("Label names; runs everything carrying any of them."),
      resolve_suite_context: z.boolean().optional().describe("Run the flow's suite auth first (API default true)."),
      environment_variables: z.record(z.string(), z.string()).optional().describe("Build variables, used as ${env:KEY}."),
      web_browser: z.enum(["chrome", "chromium", "firefox", "edge"]).optional(),
      wait: z.boolean().default(true).describe("Block until the batch finishes (default true)."),
      timeout_s: timeoutField,
      poll_s: pollField,
    },
  },
  tool("run_and_wait", async (a: Record<string, any>, extra) => {
    if (!a.flow_ids?.length && !a.suite_ids?.length && !a.labels?.length)
      throw new Error("Pass at least one of flow_ids, suite_ids, labels.");
    // The official MCP hands out app UUIDs; the REST docs describe web app_id as the app's slug.
    // Map a UUID to its slug so either works.
    let appId: string = a.app_id;
    if (!a.bundle_id && uuid.safeParse(appId).success) {
      const r = await api<{ apps?: { id: string; bundle_id: string }[] }>("GET", "/api/v1/apps");
      appId = r.apps?.find((x) => x.id === appId)?.bundle_id ?? appId;
    }
    const body: Record<string, unknown> = {
      ...(a.bundle_id ? { bundle_id: a.bundle_id, platform: a.platform } : { app_id: appId }),
      flow_ids: a.flow_ids,
      suite_ids: a.suite_ids,
      labels: a.labels,
      resolve_suite_context: a.resolve_suite_context,
      variables: a.environment_variables,
      web_browser: a.web_browser,
    };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    const start = await api<RunStart>("POST", "/api/v1/flows/run", body);
    if (!a.wait) {
      return {
        text: `RESULT: STARTED (${start.flow_run_count} flow runs)\nbatch_id: ${start.batch_id}\nbatch_url: ${start.batch_url}\nNext: call batch_status with wait=true.`,
        meta: { batch_id: start.batch_id },
      };
    }
    const r = await waitForBatch(start.batch_id, a.timeout_s, a.poll_s, extra);
    return {
      text: formatBatch(r.status, { waitedSeconds: r.waited, timedOut: r.timedOut }),
      meta: { batch_id: start.batch_id, polls: r.polls, waited_s: r.waited, timed_out: r.timedOut },
    };
  }),
);

server.registerTool(
  "batch_status",
  {
    title: "Status of a run batch",
    description:
      "Status of every flow in a batch (the batch_id printed by flows_run, suites_run, labels_run, run_and_wait, " +
      "or `autosana run`). With wait=true, blocks until the batch finishes or timeout_s passes. " +
      "First line is RESULT: PASSED / FAILED / RUNNING / TIMEOUT.",
    inputSchema: {
      batch_id: uuid,
      wait: z.boolean().default(false),
      timeout_s: timeoutField,
      poll_s: pollField,
    },
  },
  tool("batch_status", async (a: { batch_id: string; wait: boolean; timeout_s: number; poll_s: number }, extra) => {
    if (!a.wait) {
      const s = await api<BatchStatus>("GET", `/api/v1/runs/status?batch_id=${encodeURIComponent(a.batch_id)}`);
      return { text: formatBatch(s), meta: { polls: 1 } };
    }
    const r = await waitForBatch(a.batch_id, a.timeout_s, a.poll_s, extra);
    return {
      text: formatBatch(r.status, { waitedSeconds: r.waited, timedOut: r.timedOut }),
      meta: { polls: r.polls, waited_s: r.waited, timed_out: r.timedOut },
    };
  }),
);

server.registerTool(
  "run_details",
  {
    title: "Why a flow run passed or failed",
    description:
      "Compact result of one flow run: status, duration, reviewer summary, failing step or hook, and issues. " +
      "Takes the run_id from batch_status / run_and_wait. Steps and signed URLs (screenshots, recording, logs) are opt-in.",
    inputSchema: {
      run_id: uuid,
      include_actions: z.boolean().default(false).describe("List every step."),
      include_urls: z.boolean().default(false).describe("Add screenshot, recording and log URLs (signed, expire in 24h)."),
    },
  },
  tool("run_details", async (a: { run_id: string; include_actions: boolean; include_urls: boolean }) => {
    const r = await api<RunDetails>("GET", `/api/v1/runs/${encodeURIComponent(a.run_id)}`);
    return {
      text: formatRun(r, { includeActions: a.include_actions, includeUrls: a.include_urls }),
      meta: { actions: r.actions.length },
    };
  }),
);

await server.connect(new StdioServerTransport());
