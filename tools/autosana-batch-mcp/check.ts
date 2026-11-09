// Verifies the API key works without printing it: prints only the HTTP status of GET /api/v1/devices.
import { api, ApiError, loadApiKey } from "./api.ts";

try {
  loadApiKey();
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
try {
  const d = await api<{ devices: unknown[] }>("GET", "/api/v1/devices");
  console.log(`OK: REST API accepted the key (GET /api/v1/devices -> 200, ${d.devices?.length ?? 0} device models)`);
} catch (e) {
  if (e instanceof ApiError) console.error(`FAILED: HTTP ${e.status}${e.status === 401 || e.status === 403 ? " (key rejected)" : ""}`);
  else console.error(`FAILED: ${(e as Error).message}`);
  process.exit(1);
}
