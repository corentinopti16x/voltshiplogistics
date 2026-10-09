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
  /** Carrier service line (e.g. "YunExpress CHC"); null for legacy cells. */
  lineName?: string | null;
  /**
   * INTERNAL — raw carrier cost of the bracket in RMB (null for cells imported before
   * the assistant). Never copied into `CogsBreakdown`, so it never reaches a client view.
   */
  carrierCostRmb?: number | null;
  /** INTERNAL — false when the EU parcel tax was added on top of the carrier price. */
  taxIncluded?: boolean | null;
  /** The line ships under the client's IOSS number (informational, not a cost). */
  iossRequired?: boolean | null;
};

/** Product dimensions in cm (quote_json length_cm / width_cm / height_cm). */
export type ParcelDimensionsCm = { length_cm: number; width_cm: number; height_cm: number };

/** Volumetric divisor per carrier (cm³ → kg); `default` for carriers not listed. */
export type VolumetricDivisors = Record<string, number>;

export const DEFAULT_VOLUMETRIC_DIVISORS: VolumetricDivisors = { Huahan: 6000, default: 8000 };

/** USA lines bill at least 50 g. */
export const US_MIN_BILLABLE_G = 50;

export function volumetricDivisorFor(carrier: string, divisors: VolumetricDivisors = DEFAULT_VOLUMETRIC_DIVISORS) {
  const value = divisors[carrier] ?? divisors.default ?? DEFAULT_VOLUMETRIC_DIVISORS.default;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_VOLUMETRIC_DIVISORS.default;
}

export function parseParcelDimensions(raw: unknown): ParcelDimensionsCm | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const read = (key: string) => {
    const value = Number(source[key]);
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const length_cm = read("length_cm");
  const width_cm = read("width_cm");
  const height_cm = read("height_cm");
  if (length_cm == null || width_cm == null || height_cm == null) return null;
  return { length_cm, width_cm, height_cm };
}

/**
 * Volumetric weight in grams of `quantity` units: n × L×W×H (cm³) / divisor × 1000.
 * The volume of n units is approximated as n × unit volume. Null without dimensions.
 */
export function volumetricWeightG(
  dimensions: ParcelDimensionsCm | null | undefined,
  quantity: number,
  divisor: number,
): number | null {
  if (!dimensions) return null;
  const volume = dimensions.length_cm * dimensions.width_cm * dimensions.height_cm * quantity;
  if (!Number.isFinite(volume) || volume <= 0) return null;
  return Math.round((volume / divisor) * 1000);
}

export type BilledWeightInput = {
  /** Actual parcel weight in grams (quantity × unit weight). */
  actualG: number;
  quantity?: number | null;
  dimensionsCm?: ParcelDimensionsCm | null;
  carrier: string;
  destination: string;
  volumetricDivisors?: VolumetricDivisors | null;
};

/**
 * Billed weight = max(actual, volumetric) for the carrier's divisor (Huahan 6000, others
 * 8000), at least 50 g for the USA. Actual weight when dimensions are unknown.
 */
export function billedWeightG(input: BilledWeightInput) {
  const divisor = volumetricDivisorFor(input.carrier, input.volumetricDivisors ?? DEFAULT_VOLUMETRIC_DIVISORS);
  const volumetric = volumetricWeightG(input.dimensionsCm, input.quantity ?? 1, divisor) ?? 0;
  let billed = Math.max(input.actualG, volumetric);
  if (normalizeDestination(input.destination) === "US") billed = Math.max(billed, US_MIN_BILLABLE_G);
  return Math.round(billed);
}

/** A carrier service line: carrier + line name (null line for legacy single-line grids). */
export type CarrierLineRef = { carrier: string; lineName: string | null };

/** Why a rate cell was picked: the client's chosen line, the cheapest, or the cheapest because the chosen line has no bracket at this weight. */
export type SelectionReason = "preferred" | "cheapest" | "fallback_preferred_unavailable";

/** "Carrier|Line" key used by the admin rules (blocked / forced lines). */
export function lineKey(carrier: string, lineName: string | null | undefined) {
  return `${carrier}|${lineName ?? ""}`;
}

export function sameLine(a: CarrierLineRef | null | undefined, b: CarrierLineRef | null | undefined) {
  if (!a || !b) return false;
  return a.carrier === b.carrier && (a.lineName ?? "") === (b.lineName ?? "");
}

/** Extra handling above the 1-unit fee, by parcel size (see PricingSettings). */
export type HandlingLadder = { step2: number; step3: number; extraUnit: number };

export const FLAT_HANDLING: HandlingLadder = { step2: 0, step3: 0, extraUnit: 0 };

export const DEFAULT_HANDLING_LADDER: HandlingLadder = { step2: 0.15, step3: 0.3, extraUnit: 0.15 };

/** Handling for a parcel of `quantity` units: base fee + 0,15 € per extra unit by default (1 → 1,15 → 1,30 → 1,45 €). */
export function handlingForQuantity(base: number, quantity: number, ladder?: HandlingLadder | null) {
  const fee = Math.max(0, base);
  const q = Math.max(1, Math.floor(quantity || 1));
  const l = ladder ?? DEFAULT_HANDLING_LADDER;
  if (q === 1 || fee === 0) return money(fee);
  if (q === 2) return money(fee + Math.max(0, l.step2));
  return money(fee + Math.max(0, l.step3) + (q - 3) * Math.max(0, l.extraUnit));
}

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
  /**
   * Units in the parcel (default 1). The product component and its commission scale
   * with the quantity, the rate cell is picked for the parcel weight
   * (quantity × unit weight) and the handling fee is charged once per order.
   */
  quantity?: number | null;
  /** Unit dimensions (cm) → volumetric weight; billed weight = max(actual, volumetric). */
  dimensionsCm?: ParcelDimensionsCm | null;
  volumetricDivisors?: VolumetricDivisors | null;
  /** Line chosen by the client (or forced by Voltship) for this market; null/absent = cheapest. */
  carrierPreference?: CarrierLineRef | null;
  /** When set, only these lines (`lineKey`) may be picked — admin "Autorisée" rules. */
  allowedLines?: Set<string> | null;
  /** Handling grows with the parcel size (default +0,15 € per extra unit). */
  handlingLadder?: HandlingLadder | null;
  /** False = fixed handling per parcel (Platinium / Gold); default true. */
  handlingGrows?: boolean | null;
  /**
   * RMB per EUR of the carrier cost: with the cell's internal carrier cost, the palier
   * discount never takes the client transport below what the carrier costs Voltship.
   */
  fxRmbPerEur?: number | null;
};

export type CogsBreakdown = {
  gridVersion: string;
  carrier: string;
  destination: string;
  channel: ShippingChannel;
  /** Units in the parcel (1 for a single-unit quote). */
  quantity: number;
  /** Actual parcel weight (quantity × unit weight). */
  weightG: number;
  /** Weight the carrier bills: max(actual, volumetric), USA ≥ 50 g. Equals weightG without dimensions. */
  billedWeightG: number;
  /** Volumetric weight for the chosen carrier, null without dimensions. */
  volumetricWeightG: number | null;
  /** The chosen line ships under the client's IOSS number (informational). */
  iossRequired: boolean;
  /** Unit product price (negotiated factory price). */
  clientPrice: number;
  /** Product component for the whole order: clientPrice × quantity. */
  product: number;
  shippingBase: number;
  shipping: number;
  handling: number;
  commission: number;
  discount: number;
  /** COGS for the whole order (all `quantity` units). */
  cogs: number;
  /** COGS per unit: cogs / quantity. */
  cogsPerUnit: number;
  deliveryRange: string | null;
  /** Carrier service line of the rate cell used (null for legacy grids). */
  lineName: string | null;
  /** Weight bracket of the rate cell used, e.g. 251–300 g. */
  weightMinG: number;
  weightMaxG: number;
  /** How the line was selected (preferred / cheapest / fallback). */
  selectionReason: SelectionReason;
  /** Total fixed by hand for this product / market / quantity (price promised to the client). */
  announced?: boolean;
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

/**
 * Cheapest cell for the parcel. `weightG` is the actual parcel weight; when
 * `dimensionsCm` is given each carrier is matched on ITS billed weight (volumetric
 * divisor per carrier), so a bulky parcel may fall into a heavier bracket for one
 * carrier and not another. Same price → narrowest bracket wins.
 */
type CellQuery = Pick<
  PricingInput,
  | "weightG"
  | "channel"
  | "destination"
  | "preferredCarrier"
  | "quantity"
  | "dimensionsCm"
  | "volumetricDivisors"
  | "carrierPreference"
  | "allowedLines"
>;

function matchingCells(cells: RateCell[], input: CellQuery) {
  const destination = normalizeDestination(input.destination);
  const billed = (carrier: string) =>
    billedWeightG({
      actualG: input.weightG,
      quantity: input.quantity ?? 1,
      dimensionsCm: input.dimensionsCm,
      carrier,
      destination,
      volumetricDivisors: input.volumetricDivisors,
    });
  const matches = cells.filter((cell) => {
    if (cell.destination.trim().toUpperCase() !== destination || cell.channel !== input.channel) return false;
    if (input.preferredCarrier && cell.carrier !== input.preferredCarrier) return false;
    if (input.allowedLines && !input.allowedLines.has(lineKey(cell.carrier, cell.lineName))) return false;
    const weight = billed(cell.carrier);
    return weight >= cell.weightMinG && weight <= cell.weightMaxG;
  });
  return matches.sort(byPriceThenNarrowest);
}

function byPriceThenNarrowest(a: RateCell, b: RateCell) {
  if (a.price !== b.price) return a.price - b.price;
  return a.weightMaxG - a.weightMinG - (b.weightMaxG - b.weightMinG);
}

/**
 * Cheapest cell (plus why it was picked). With `carrierPreference` the preferred line
 * wins when it has a bracket at this weight and is allowed; otherwise the cheapest allowed
 * line is used and the reason says the preferred line was unavailable. Blocked lines
 * (`allowedLines`) are never picked.
 */
export function selectRateCell(
  cells: RateCell[],
  input: CellQuery,
): { cell: RateCell; reason: SelectionReason } | null {
  const matches = matchingCells(cells, input);
  if (matches.length === 0) return null;
  const preference = input.carrierPreference ?? null;
  if (preference) {
    const preferred = matches.find((cell) =>
      sameLine({ carrier: cell.carrier, lineName: cell.lineName ?? null }, preference),
    );
    if (preferred) return { cell: preferred, reason: "preferred" };
    return { cell: matches[0], reason: "fallback_preferred_unavailable" };
  }
  return { cell: matches[0], reason: "cheapest" };
}

export function findRateCell(cells: RateCell[], input: CellQuery) {
  return selectRateCell(cells, input)?.cell ?? null;
}

export type RateOption = CarrierLineRef & {
  price: number;
  deliveryRange: string | null;
  iossRequired: boolean;
  weightMinG: number;
  weightMaxG: number;
  /** Billed weight for this carrier (volumetric divisor per carrier). */
  billedWeightG: number;
};

/**
 * Every line that can ship the parcel (one entry per carrier + line, the cheapest/narrowest
 * bracket of each), sorted by price. Same weight / channel / destination rules as
 * `findRateCell`; blocked lines (`allowedLines`) are left out.
 */
export function listRateOptions(cells: RateCell[], input: CellQuery): RateOption[] {
  const destination = normalizeDestination(input.destination);
  const byLine = new Map<string, RateCell>();
  for (const cell of matchingCells(cells, input)) {
    const key = lineKey(cell.carrier, cell.lineName);
    if (!byLine.has(key)) byLine.set(key, cell);
  }
  return [...byLine.values()].map((cell) => ({
    carrier: cell.carrier,
    lineName: cell.lineName ?? null,
    price: money(cell.price),
    deliveryRange: cell.deliveryRange ?? null,
    iossRequired: cell.iossRequired === true,
    weightMinG: cell.weightMinG,
    weightMaxG: cell.weightMaxG,
    billedWeightG: billedWeightG({
      actualG: input.weightG,
      quantity: input.quantity ?? 1,
      dimensionsCm: input.dimensionsCm,
      carrier: cell.carrier,
      destination,
      volumetricDivisors: input.volumetricDivisors,
    }),
  }));
}

export function calculateCogs(input: PricingInput): CogsBreakdown | null {
  const quantity = input.quantity ?? 1;
  if (
    !validNumber(input.clientPrice) ||
    !Number.isFinite(input.weightG) ||
    input.weightG <= 0 ||
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {
    return null;
  }

  // One parcel for the whole order: the rate bracket is picked for n × unit weight.
  const parcelWeightG = input.weightG * quantity;
  const selected = selectRateCell(input.cells, { ...input, weightG: parcelWeightG, quantity });
  if (!selected) return null;
  const { cell } = selected;
  const billed = billedWeightG({
    actualG: parcelWeightG,
    quantity,
    dimensionsCm: input.dimensionsCm,
    carrier: cell.carrier,
    destination: cell.destination,
    volumetricDivisors: input.volumetricDivisors,
  });
  const volumetric = volumetricWeightG(
    input.dimensionsCm,
    quantity,
    volumetricDivisorFor(cell.carrier, input.volumetricDivisors ?? DEFAULT_VOLUMETRIC_DIVISORS),
  );

  const product = money(input.clientPrice * quantity);
  const shippingBase = money(cell.price);
  // Handling (picking + packing) is charged per order and grows with the parcel size.
  const handling = handlingForQuantity(
    input.handlingFee ?? 0,
    quantity,
    input.handlingGrows === false ? FLAT_HANDLING : input.handlingLadder,
  );
  const commissionRate = Math.max(0, input.commissionPct ?? 0) / 100;
  const discountRate = Math.min(100, Math.max(0, input.logisticsDiscountPct ?? 0)) / 100;
  const commission = money(product * commissionRate);
  const shipping = discountedShipping(shippingBase, discountRate, cell.carrierCostRmb, input.fxRmbPerEur);
  const discount = money(shippingBase - shipping);
  const cogs = money(product + commission + shipping + handling);

  return {
    gridVersion: cell.gridVersion,
    carrier: cell.carrier,
    destination: cell.destination.toUpperCase(),
    channel: cell.channel,
    quantity,
    weightG: parcelWeightG,
    billedWeightG: billed,
    volumetricWeightG: volumetric,
    iossRequired: cell.iossRequired === true,
    clientPrice: money(input.clientPrice),
    product,
    shippingBase,
    shipping,
    handling,
    commission,
    discount,
    cogs,
    cogsPerUnit: money(cogs / quantity),
    deliveryRange: cell.deliveryRange ?? null,
    lineName: cell.lineName ?? null,
    weightMinG: cell.weightMinG,
    weightMaxG: cell.weightMaxG,
    selectionReason: selected.reason,
  };
}

/**
 * Client transport after the palier discount, never below the carrier cost (when the
 * internal cost of the cell is known): the discount only eats into Voltship's markup.
 */
export function discountedShipping(
  price: number,
  discountRate: number,
  carrierCostRmb?: number | null,
  fxRmbPerEur?: number | null,
) {
  const discounted = money(price - price * Math.min(1, Math.max(0, discountRate)));
  const fx = Number(fxRmbPerEur);
  const cost = Number(carrierCostRmb);
  if (carrierCostRmb == null || !Number.isFinite(cost) || cost <= 0 || !Number.isFinite(fx) || fx <= 0) {
    return discounted;
  }
  const floor = Math.ceil((cost / fx) * 100 - 1e-9) / 100;
  return money(Math.min(price, Math.max(discounted, floor)));
}

/** "251–300 g" label for a rate bracket. */
export function formatWeightTier(weightMinG: number, weightMaxG: number) {
  return `${weightMinG}–${weightMaxG} g`;
}

/** Quantities shown in the COGS 1–5 matrix. */
export const COGS_MATRIX_QUANTITIES = [1, 2, 3, 4, 5] as const;

/**
 * Markets a product is sold on, from its brief (`destination_markets`, e.g. "FR, DE").
 * Falls back to FR. The first market is the primary one.
 */
export function parseDestinationMarkets(raw: string | null | undefined, fallback = "FR") {
  const markets: string[] = [];
  for (const part of (raw ?? "").split(/[,;/|]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const code = normalizeDestination(trimmed, "");
    if (code && !markets.includes(code)) markets.push(code);
  }
  return markets.length > 0 ? markets : [fallback];
}

/**
 * True when the live grid no longer matches the frozen accepted quote: either the
 * active grid version moved on, or the single-unit live shipping price differs from
 * the frozen one. The accepted snapshot stays the contractual figure for quantity 1.
 */
export function ratesChangedSinceQuote(
  snapshot: Pick<AcceptedQuoteSnapshot, "gridVersion" | "shipping" | "cogs"> | null,
  live: Pick<CogsBreakdown, "shipping" | "cogs"> | null,
  activeGridVersion: string | null,
) {
  if (!snapshot) return false;
  if (activeGridVersion && activeGridVersion !== snapshot.gridVersion) return true;
  if (!live) return false;
  return money(live.shipping) !== money(snapshot.shipping) || money(live.cogs) !== money(snapshot.cogs);
}

/** "2026-09-21.1" → "2026-09-21"; null when the version does not start with a date. */
export function gridVersionDate(version: string | null | undefined) {
  const match = (version ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
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
  const quantityRaw = number("quantity");
  const quantity = quantityRaw != null && quantityRaw >= 1 ? Math.round(quantityRaw) : 1;
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
    quantity,
    weightG,
    billedWeightG: number("billedWeightG", "billed_weight_g") ?? weightG,
    volumetricWeightG: number("volumetricWeightG", "volumetric_weight_g"),
    iossRequired: (row.iossRequired ?? row.ioss_required) === true,
    clientPrice,
    product: number("product") ?? clientPrice * quantity,
    shippingBase: shippingBase ?? shipping,
    shipping,
    handling,
    commission: commission ?? 0,
    discount: discount ?? 0,
    cogs,
    cogsPerUnit: number("cogsPerUnit", "cogs_per_unit") ?? cogs / quantity,
    deliveryRange:
      typeof (row.deliveryRange ?? row.delivery_range) === "string"
        ? String(row.deliveryRange ?? row.delivery_range)
        : null,
    lineName:
      typeof (row.lineName ?? row.line_name) === "string"
        ? String(row.lineName ?? row.line_name)
        : null,
    weightMinG: number("weightMinG", "weight_min_g") ?? weightG,
    weightMaxG: number("weightMaxG", "weight_max_g") ?? weightG,
    selectionReason:
      row.selectionReason === "preferred" || row.selectionReason === "fallback_preferred_unavailable"
        ? row.selectionReason
        : "cheapest",
    acceptedAt,
  };
}

/**
 * Prices promised to a client for a product, by market then quantity: total parcel price
 * in EUR (product + transport + handling), e.g. { "IT": { "1": 9.75, "2": 14.5 } }.
 * Stored in products_cache.quote_json.announced_prices.
 */
export type AnnouncedPrices = Record<string, Record<string, number>>;

export function parseAnnouncedPrices(raw: unknown): AnnouncedPrices {
  const out: AnnouncedPrices = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [market, byQty] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Z]{2}$/.test(market) || !byQty || typeof byQty !== "object") continue;
    for (const [qty, value] of Object.entries(byQty as Record<string, unknown>)) {
      const price = Number(value);
      if (!/^[1-9]$/.test(qty) || !Number.isFinite(price) || price <= 0) continue;
      (out[market] ??= {})[qty] = money(price);
    }
  }
  return out;
}

export function announcedPriceFor(prices: AnnouncedPrices, destination: string, quantity: number) {
  const value = prices[destination.toUpperCase()]?.[String(quantity)];
  return value != null && value > 0 ? value : null;
}

/** Last day (YYYY-MM-DD, inclusive) each market's announced prices are guaranteed. */
export type AnnouncedUntil = Record<string, string>;

export function parseAnnouncedUntil(raw: unknown): AnnouncedUntil {
  const out: AnnouncedUntil = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [market, value] of Object.entries(raw as Record<string, unknown>)) {
    if (/^[A-Z]{2}$/.test(market) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      out[market] = value;
    }
  }
  return out;
}

export function todayIso(now: Date = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** True once the guarantee date of the market is past (no date = guaranteed until removed). */
export function announcedExpired(until: AnnouncedUntil, market: string, today: string = todayIso()) {
  const last = until[market.toUpperCase()];
  return last != null && last < today;
}

/**
 * Announced prices still guaranteed today (quote_json.announced_prices minus the markets whose
 * `announced_until` date is past): an expired market falls back to the live palier rule.
 */
export function activeAnnouncedPrices(quoteJson: Record<string, unknown> | null | undefined, today: string = todayIso()) {
  const prices = parseAnnouncedPrices(quoteJson?.announced_prices);
  const until = parseAnnouncedUntil(quoteJson?.announced_until);
  for (const market of Object.keys(prices)) if (announcedExpired(until, market, today)) delete prices[market];
  return prices;
}

export type AnnouncedAlertStatus = "expired" | "loss" | "low_margin" | "expiring" | "no_data" | "ok";

/** Days before the guarantee date from which an announced price is flagged « expire bientôt ». */
export const ANNOUNCED_EXPIRY_WARNING_DAYS = 14;

/**
 * Health of one locked price: expired, selling at a loss, under the alert threshold, close
 * to its guarantee date, impossible to compute (product data / rate missing) or fine.
 */
export function classifyAnnouncedPrice(input: {
  until: string | null;
  today: string;
  margin: number | null;
  threshold: number;
}): AnnouncedAlertStatus {
  if (input.until && input.until < input.today) return "expired";
  if (input.margin == null) return "no_data";
  if (input.margin < 0) return "loss";
  if (input.margin < input.threshold) return "low_margin";
  if (input.until) {
    const days = (Date.parse(`${input.until}T00:00:00Z`) - Date.parse(`${input.today}T00:00:00Z`)) / 86_400_000;
    if (days <= ANNOUNCED_EXPIRY_WARNING_DAYS) return "expiring";
  }
  return "ok";
}

/**
 * The client pays exactly the announced total: product, commission and handling stay as
 * computed, the transport line absorbs the difference (it is what was negotiated).
 */
export function applyAnnouncedPrice(breakdown: CogsBreakdown, price: number): CogsBreakdown {
  const shipping = money(price - breakdown.product - breakdown.commission - breakdown.handling);
  return {
    ...breakdown,
    shipping,
    discount: money(breakdown.shippingBase - shipping),
    cogs: money(price),
    cogsPerUnit: money(price / breakdown.quantity),
    announced: true,
  };
}
