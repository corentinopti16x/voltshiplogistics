/**
 * Scheduled grid activation (pure helpers). A grid imported in advance can be set to go
 * live at a given time (e.g. the day a carrier's new prices start). Stored in
 * `pricing_meta` under SCHEDULED_GRID_KEY as JSON { grid_version, at (ISO UTC), by }.
 *
 * From `at` on, the pricing engine already uses the scheduled grid (no wait for the cron);
 * the cron then writes it as `active_grid_version` and clears the schedule.
 */

export const SCHEDULED_GRID_KEY = "scheduled_grid_activation";

/** China has no daylight saving: Shanghai is always UTC+8. */
const SHANGHAI_OFFSET_MINUTES = 8 * 60;

export type GridSchedule = { gridVersion: string; at: string; by: string | null };

export function parseGridSchedule(raw: unknown): GridSchedule | null {
  let source: unknown = raw;
  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  const gridVersion = typeof record.grid_version === "string" ? record.grid_version.trim() : "";
  const at = typeof record.at === "string" ? record.at : "";
  if (!gridVersion || !at || Number.isNaN(Date.parse(at))) return null;
  return { gridVersion, at: new Date(at).toISOString(), by: typeof record.by === "string" ? record.by : null };
}

export function serializeGridSchedule(schedule: GridSchedule) {
  return JSON.stringify({ grid_version: schedule.gridVersion, at: schedule.at, by: schedule.by });
}

/** "2026-10-12T09:00" typed in Shanghai time → ISO UTC ("2026-10-12T01:00:00.000Z"). */
export function shanghaiLocalToIso(local: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local.trim());
  if (!match) return null;
  const [, y, m, d, hh, mm] = match.map(Number);
  const utc = Date.UTC(y, m - 1, d, hh, mm) - SHANGHAI_OFFSET_MINUTES * 60_000;
  return Number.isFinite(utc) ? new Date(utc).toISOString() : null;
}

/** ISO UTC → "2026-10-12 09:00" in Shanghai time (for display and form defaults). */
export function isoToShanghaiLocal(iso: string) {
  const shifted = new Date(Date.parse(iso) + SHANGHAI_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 16).replace("T", " ");
}

export function scheduleIsDue(schedule: GridSchedule | null, now: Date = new Date()) {
  return schedule != null && Date.parse(schedule.at) <= now.getTime();
}

/** Grid the engine must use now: the scheduled one once its time has come, else the active one. */
export function effectiveGridVersion(
  active: string | null,
  schedule: GridSchedule | null,
  now: Date = new Date(),
): string | null {
  if (schedule && scheduleIsDue(schedule, now)) return schedule.gridVersion;
  return active && active !== "uninitialized" ? active : null;
}

/** "YYYY-MM-DDT09:00" for tomorrow in China time (default of the schedule field). */
export function tomorrowNineShanghai(now: Date) {
  const shanghai = new Date(now.getTime() + SHANGHAI_OFFSET_MINUTES * 60_000);
  shanghai.setUTCDate(shanghai.getUTCDate() + 1);
  return `${shanghai.toISOString().slice(0, 10)}T09:00`;
}
