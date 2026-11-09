// Thin client for the Autosana public REST API (https://docs.autosana.ai/api-runs).
// The API key is read from the environment or a .env file and is never logged or returned.

import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.AUTOSANA_BASE_URL ?? "https://backend.autosana.ai";
const LOG_DIR = join(HERE, "logs");

function readKeyFromEnvFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*(AUTOSANA_API_KEY|AUTOSANA_KEY)\s*=\s*(.*)\s*$/);
    if (m) return m[2].replace(/^["']|["']$/g, "") || undefined;
  }
  return undefined;
}

export function loadApiKey(): string {
  const fromEnv = process.env.AUTOSANA_API_KEY ?? process.env.AUTOSANA_KEY;
  if (fromEnv) return fromEnv;
  const envFile = process.env.AUTOSANA_ENV_FILE ?? resolve(HERE, "../../.env");
  const fromFile = readKeyFromEnvFile(envFile);
  if (fromFile) return fromFile;
  throw new Error(
    "No Autosana API key. Set AUTOSANA_API_KEY, or AUTOSANA_KEY in the repo .env, or point AUTOSANA_ENV_FILE at a .env file.",
  );
}

export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, message: string, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      "X-API-Key": loadApiKey(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 500);
    try {
      const j = JSON.parse(text);
      detail = j.detail ?? j.message ?? j.error ?? detail;
      if (typeof detail !== "string") detail = JSON.stringify(detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, `HTTP ${res.status} on ${method} ${path}: ${detail}`, res.headers.get("x-autosana-error"));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------- Types (only the fields we use) ----------

export interface RunRef {
  id: string;
  name: string;
  status: string;
  url: string;
  summary?: string | null;
}
export interface RunGroup {
  name: string;
  status: string;
  url: string;
  runs: RunRef[];
}
export interface BatchStatus {
  batch_id: string;
  batch_url: string;
  name: string | null;
  is_complete: boolean;
  summary: {
    total_flows: number;
    passed_flows: number;
    failed_flows: number;
    error_flows: number;
    terminated_flows: number;
    skipped_flows: number;
  };
  run_groups: RunGroup[];
}
export interface RunStart {
  batch_id: string;
  batch_url: string;
  flow_group_run_ids: string[];
  flow_run_count: number;
}
export interface Action {
  position: number;
  type: string;
  status: string;
  description: string;
  value: string | null;
  screenshot_url: string | null;
  annotated_screenshot_url: string | null;
}
export interface RunDetails {
  run_id: string;
  flow_name: string;
  platform: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  issues?: { type: string; severity: string; title: string; description: string }[];
  url: string;
  recording_url: string | null;
  performance_data_url: string | null;
  device_log_url: string | null;
  network_log_url: string | null;
  actions: Action[];
  hook_runs?: { hook_type: string; name: string | null; slug: string; status: string }[];
}

// ---------- Formatting: one RESULT line first, then one line per flow ----------

const TERMINAL = new Set(["passed", "failed", "error", "terminated", "skipped"]);

export function batchVerdict(b: BatchStatus): "passed" | "failed" | "running" {
  if (!b.is_complete) return "running";
  const s = b.summary;
  return s.total_flows > 0 && s.passed_flows === s.total_flows ? "passed" : "failed";
}

export function formatBatch(b: BatchStatus, opts: { waitedSeconds?: number; timedOut?: boolean } = {}): string {
  const s = b.summary;
  const verdict = opts.timedOut ? "timeout" : batchVerdict(b);
  const counts = [
    `${s.passed_flows}/${s.total_flows} passed`,
    s.failed_flows ? `${s.failed_flows} failed` : "",
    s.error_flows ? `${s.error_flows} error` : "",
    s.terminated_flows ? `${s.terminated_flows} terminated` : "",
    s.skipped_flows ? `${s.skipped_flows} skipped` : "",
  ].filter(Boolean);
  const lines = [
    `RESULT: ${verdict.toUpperCase()} (${counts.join(", ")})` +
      (opts.waitedSeconds !== undefined ? ` after ${opts.waitedSeconds}s` : ""),
    `batch_id: ${b.batch_id}`,
    `batch_url: ${b.batch_url}`,
  ];
  for (const g of b.run_groups) {
    for (const r of g.runs) {
      const prefix = g.runs.length > 1 ? `${g.name} / ` : "";
      lines.push(`- [${r.status}] ${prefix}${r.name}  run_id=${r.id}`);
      if (r.summary && TERMINAL.has(r.status)) lines.push(`    ${oneLine(r.summary, 400)}`);
    }
  }
  if (verdict === "failed") lines.push("Next: call run_details with a failed run_id for the failing step.");
  if (verdict === "running" || verdict === "timeout") lines.push("Next: call batch_status with wait=true to keep waiting.");
  return lines.join("\n");
}

export function formatRun(r: RunDetails, opts: { includeActions: boolean; includeUrls: boolean }): string {
  const dur =
    r.started_at && r.completed_at
      ? `${Math.round((Date.parse(r.completed_at) - Date.parse(r.started_at)) / 1000)}s`
      : "n/a";
  const lines = [
    `RESULT: ${r.status.toUpperCase()}  ${r.flow_name}  (${r.platform}, ${dur}, ${r.actions.length} actions)`,
    `url: ${r.url}`,
  ];
  if (r.summary) lines.push(`summary: ${oneLine(r.summary, 800)}`);

  const bad = r.actions.find((a) => a.status !== "passed" && a.type !== "pass");
  const last = r.actions[r.actions.length - 1];
  if (bad) lines.push(`failing_step: #${bad.position} ${bad.type}: ${oneLine(bad.description, 300)}`);
  else if (last && r.status !== "passed") lines.push(`last_step: #${last.position} ${last.type}: ${oneLine(last.description, 300)}`);
  const badHook = r.hook_runs?.find((h) => h.status !== "passed");
  if (badHook) lines.push(`failing_hook: ${badHook.hook_type} ${badHook.name ?? badHook.slug} (${badHook.status})`);

  for (const i of r.issues ?? []) lines.push(`issue [${i.severity} ${i.type}]: ${i.title}`);

  if (opts.includeActions) {
    lines.push("actions:");
    for (const a of r.actions) {
      const val = a.value ? ` = ${oneLine(a.value, 80)}` : "";
      const shot = opts.includeUrls && a.screenshot_url ? `  ${a.screenshot_url}` : "";
      lines.push(`  #${a.position} [${a.status}] ${a.type}: ${oneLine(a.description, 200)}${val}${shot}`);
    }
  }
  if (opts.includeUrls) {
    for (const [k, v] of Object.entries({
      recording_url: r.recording_url,
      device_log_url: r.device_log_url,
      network_log_url: r.network_log_url,
      performance_data_url: r.performance_data_url,
    })) if (v) lines.push(`${k}: ${v}`);
  } else {
    lines.push("(pass include_actions / include_urls for steps, screenshots, recording and logs)");
  }
  return lines.join("\n");
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// ---------- Evidence log: one JSON line per tool call (no secrets) ----------

export function logCall(entry: Record<string, unknown>): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, "calls.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    /* logging must never break a tool call */
  }
}
