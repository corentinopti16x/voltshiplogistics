import type { ShippingChannel } from "./pricing";

const CHANNELS: ShippingChannel[] = [
  "standard",
  "electronics_battery",
  "cosmetics",
  "liquid_perfume",
  "magnetic",
  "sensitive_other",
];

export type RateGridCsvRow = {
  carrier: string;
  destination: string;
  channel: ShippingChannel;
  weightMinG: number;
  weightMaxG: number;
  price: number;
  deliveryRange: string | null;
};

export type RateGridCsvResult = {
  rows: RateGridCsvRow[];
  errors: string[];
};

const HEADERS = [
  "carrier",
  "destination",
  "channel",
  "weight_min_g",
  "weight_max_g",
  "price",
  "delivery_range",
] as const;

export const RATE_GRID_CSV_TEMPLATE = `${HEADERS.join(",")}
YunExpress,FR,standard,0,500,3.90,8-12 days
YunExpress,FR,standard,501,1000,5.40,8-12 days
`;

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseRateGridCsv(text: string): RateGridCsvResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], errors: ["Add a header row and at least one rate."] };
  }

  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const missing = HEADERS.filter((name) => !header.includes(name));
  if (missing.length > 0) {
    return { rows: [], errors: [`Missing columns: ${missing.join(", ")}.`] };
  }

  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  const rows: RateGridCsvRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  lines.slice(1).forEach((line, offset) => {
    const lineNumber = offset + 2;
    const cells = splitCsvLine(line);
    const value = (name: (typeof HEADERS)[number]) => cells[index[name]] ?? "";
    const carrier = value("carrier");
    const destination = value("destination").toUpperCase();
    const channel = value("channel") as ShippingChannel;
    const weightMinG = Number(value("weight_min_g"));
    const weightMaxG = Number(value("weight_max_g"));
    const price = Number(value("price"));
    const deliveryRange = value("delivery_range") || null;
    const problems: string[] = [];

    if (!carrier) problems.push("carrier");
    if (!/^[A-Z]{2}$/.test(destination)) problems.push("destination");
    if (!CHANNELS.includes(channel)) problems.push("channel");
    if (!Number.isInteger(weightMinG) || weightMinG < 0) problems.push("weight_min_g");
    if (!Number.isInteger(weightMaxG) || weightMaxG < weightMinG) problems.push("weight_max_g");
    if (!Number.isFinite(price) || price < 0) problems.push("price");

    const key = [carrier, destination, channel, weightMinG, weightMaxG].join("|");
    if (seen.has(key)) problems.push("duplicate");
    seen.add(key);

    if (problems.length > 0) {
      errors.push(`Line ${lineNumber}: ${problems.join(", ")}.`);
      return;
    }

    rows.push({
      carrier,
      destination,
      channel,
      weightMinG,
      weightMaxG,
      price,
      deliveryRange,
    });
  });

  return { rows, errors };
}
