export type ShippingChannel =
  | "standard"
  | "electronics_battery"
  | "cosmetics"
  | "liquid_perfume"
  | "magnetic"
  | "sensitive_other";

export type RateCell = {
  gridVersion: string;
  carrier: string;
  destination: string;
  channel: ShippingChannel;
  weightMinG: number;
  weightMaxG: number;
  price: number;
  deliveryRange?: string | null;
};

export type PricingInput = {
  clientPrice: number;
  weightG: number;
  channel: ShippingChannel;
  destination: string;
  cells: RateCell[];
  handlingFee?: number | null;
  commissionPct?: number | null;
  logisticsDiscountPct?: number | null;
  preferredCarrier?: string | null;
};

export type CogsBreakdown = {
  gridVersion: string;
  carrier: string;
  destination: string;
  channel: ShippingChannel;
  weightG: number;
  clientPrice: number;
  shippingBase: number;
  shipping: number;
  handling: number;
  commission: number;
  discount: number;
  cogs: number;
  deliveryRange: string | null;
};

export type AcceptedQuoteSnapshot = CogsBreakdown & {
  acceptedAt: string;
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function validNumber(value: number) {
  return Number.isFinite(value) && value >= 0;
}

const countryAliases: Record<string, string> = {
  france: "FR",
  india: "IN",
  germany: "DE",
  italy: "IT",
  spain: "ES",
  "united kingdom": "GB",
  uk: "GB",
  "united states": "US",
  usa: "US",
};

export function normalizeDestination(value: string, fallback = "FR") {
  const first = value.split(",")[0]?.trim().toLowerCase() ?? "";
  if (/^[a-z]{2}$/i.test(first)) return first.toUpperCase();
  return countryAliases[first] ?? fallback;
}

export function findRateCell(
  cells: RateCell[],
  input: Pick<PricingInput, "weightG" | "channel" | "destination" | "preferredCarrier">,
) {
  const destination = normalizeDestination(input.destination);
  const matches = cells.filter(
    (cell) =>
      cell.destination.trim().toUpperCase() === destination &&
      cell.channel === input.channel &&
      input.weightG >= cell.weightMinG &&
      input.weightG <= cell.weightMaxG &&
      (!input.preferredCarrier || cell.carrier === input.preferredCarrier),
  );

  return matches.sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    return a.weightMaxG - a.weightMinG - (b.weightMaxG - b.weightMinG);
  })[0] ?? null;
}

export function calculateCogs(input: PricingInput): CogsBreakdown | null {
  if (
    !validNumber(input.clientPrice) ||
    !Number.isFinite(input.weightG) ||
    input.weightG <= 0
  ) {
    return null;
  }

  const cell = findRateCell(input.cells, input);
  if (!cell) return null;

  const shippingBase = money(cell.price);
  const handling = money(Math.max(0, input.handlingFee ?? 0));
  const commissionRate = Math.max(0, input.commissionPct ?? 0) / 100;
  const discountRate = Math.min(100, Math.max(0, input.logisticsDiscountPct ?? 0)) / 100;
  const commission = money(input.clientPrice * commissionRate);
  const discount = money(shippingBase * discountRate);
  const shipping = money(shippingBase - discount);
  const cogs = money(input.clientPrice + commission + shipping + handling);

  return {
    gridVersion: cell.gridVersion,
    carrier: cell.carrier,
    destination: cell.destination.toUpperCase(),
    channel: cell.channel,
    weightG: input.weightG,
    clientPrice: money(input.clientPrice),
    shippingBase,
    shipping,
    handling,
    commission,
    discount,
    cogs,
    deliveryRange: cell.deliveryRange ?? null,
  };
}

export function freezeQuote(
  breakdown: CogsBreakdown,
  acceptedAt = new Date().toISOString(),
): AcceptedQuoteSnapshot {
  return { ...breakdown, acceptedAt };
}

export function parseAcceptedQuoteSnapshot(raw: unknown): AcceptedQuoteSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const channel = row.channel ?? row.shipping_channel;
  const acceptedAt = row.acceptedAt ?? row.accepted_at;
  const gridVersion = row.gridVersion ?? row.grid_version;
  if (
    typeof gridVersion !== "string" ||
    typeof row.carrier !== "string" ||
    typeof row.destination !== "string" ||
    typeof channel !== "string" ||
    typeof acceptedAt !== "string"
  ) {
    return null;
  }

  const number = (camel: string, snake = camel) => {
    const value = Number(row[camel] ?? row[snake]);
    return Number.isFinite(value) ? value : null;
  };
  const weightG = number("weightG", "weight_g");
  const clientPrice = number("clientPrice", "client_price");
  const shippingBase = number("shippingBase", "shipping_base");
  const shipping = number("shipping");
  const handling = number("handling");
  const commission = number("commission");
  const discount = number("discount");
  const cogs = number("cogs");
  if (
    weightG == null ||
    clientPrice == null ||
    shipping == null ||
    handling == null ||
    cogs == null
  ) {
    return null;
  }

  return {
    gridVersion,
    carrier: row.carrier,
    destination: row.destination,
    channel: channel as ShippingChannel,
    weightG,
    clientPrice,
    shippingBase: shippingBase ?? shipping,
    shipping,
    handling,
    commission: commission ?? 0,
    discount: discount ?? 0,
    cogs,
    deliveryRange:
      typeof (row.deliveryRange ?? row.delivery_range) === "string"
        ? String(row.deliveryRange ?? row.delivery_range)
        : null,
    acceptedAt,
  };
}
