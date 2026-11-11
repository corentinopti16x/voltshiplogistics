/**
 * Transport configuration of one carrier line for one country (table `carrier_line_settings`).
 * Pure helpers: the key of a line, and dropping the lines that are not open yet.
 */

export type LineStatus = "active" | "pending";

export type LineSetting = {
  destination: string;
  carrier: string;
  lineName: string | null;
  /** « pending » = the line exists at the carrier but is not open at Voltship yet. */
  status: LineStatus;
  /** ECCANG shipping method the parcels of this country ship on. */
  eccangMethod: string | null;
  /** Delivery time shown to the team ("8-12"); overrides the grid's own value. */
  deliveryDays: string | null;
  note: string | null;
  updatedAt: string | null;
};

export function lineSettingKey(
  destination: string,
  carrier: string,
  lineName?: string | null,
) {
  return `${destination.trim().toUpperCase()}|${carrier.trim().toLowerCase()}|${(lineName ?? "").trim().toLowerCase()}`;
}

export function indexLineSettings(settings: LineSetting[]) {
  return new Map(
    settings.map((setting) => [
      lineSettingKey(setting.destination, setting.carrier, setting.lineName),
      setting,
    ]),
  );
}

/** Keys of the lines the pricing engine must ignore. */
export function pendingLineKeys(settings: LineSetting[]) {
  return new Set(
    settings
      .filter((setting) => setting.status === "pending")
      .map((setting) =>
        lineSettingKey(setting.destination, setting.carrier, setting.lineName),
      ),
  );
}

/** Removes the brackets of the lines that are not open yet. */
export function dropPendingLines<
  T extends { destination: string; carrier: string; lineName?: string | null },
>(cells: T[], pending: ReadonlySet<string>): T[] {
  if (pending.size === 0) return cells;
  return cells.filter(
    (cell) =>
      !pending.has(
        lineSettingKey(cell.destination, cell.carrier, cell.lineName),
      ),
  );
}

const MAX_TEXT = 300;

/** Trims a free text field; empty → null; refuses anything longer than 300 characters. */
export function cleanSettingText(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length > MAX_TEXT) return { ok: false };
  return { ok: true, value: value || null };
}
