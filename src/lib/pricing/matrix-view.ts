import type { CogsBreakdown, CarrierLineRef, RateOption, SelectionReason } from "../domain/pricing";
import { isLimitedCoverageCarrier, lineKey } from "../domain/pricing";

/** Minimal shape of `ProductCogsMatrix` (lib/pricing/server) needed for the views. */
type MatrixLike = {
  markets: Array<{
    destination: string;
    cells: Array<{ quantity: number; breakdown: CogsBreakdown | null; covered?: CogsBreakdown | null }>;
    options: RateOption[];
    preference: CarrierLineRef | null;
    forced: boolean;
    autoCarriers?: string[] | null;
  }>;
};

/** How the line of a market is decided: Voltship rule, chosen line, or cheapest. */
export type CarrierMode = "forced" | "preferred" | "auto";

export type CogsMatrixCellView = {
  quantity: number;
  /** COGS for the whole order (n units), null when no weight bracket matches. */
  cogs: number | null;
  cogsPerUnit: number | null;
  weightG: number | null;
  /** Billed weight (volumetric / USA minimum); shown when it differs from weightG. */
  billedWeightG: number | null;
  iossRequired: boolean;
  carrier: string | null;
  lineName: string | null;
  weightMinG: number | null;
  weightMaxG: number | null;
  /** Parcel shipping price from the rate cell (after client discount). */
  shipping: number | null;
  deliveryRange: string | null;
  /** Products (+ boxes) in the parcel and the packaging added on top (weightG = both). */
  contentWeightG: number | null;
  packagingWeightG: number | null;
  /** Cheaper COGS when the postcode is covered by a limited-coverage line (Huahan USA…). */
  coveredCogs: number | null;
  coveredLine: CarrierLineRef | null;
};

export type CogsMatrixMarketView = {
  destination: string;
  cells: CogsMatrixCellView[];
  /** Line used for 1 unit (the reference line of the market), null when nothing matches. */
  line: CarrierLineRef | null;
  deliveryRange: string | null;
  mode: CarrierMode;
  /** The chosen / forced line cannot ship 1 unit: the cheapest line is used instead. */
  fallback: boolean;
};

export type CarrierSelectorMarket = {
  destination: string;
  /** Lines able to ship 1 unit (blocked lines already removed), cheapest first. */
  options: RateOption[];
  /** Effective preference (forced or chosen); null = cheapest (auto). */
  preference: CarrierLineRef | null;
  forced: boolean;
  /** Reason of the single-unit selection (null when no rate matches). */
  selectionReason: SelectionReason | null;
  /** Line the automatic choice uses for 1 unit (may differ from the cheapest option). */
  autoLine: CarrierLineRef | null;
  /** Option keys (lineKey) with limited postcode coverage, left out of the automatic choice. */
  limitedLines: string[];
};

export function carrierModeOf(market: { preference: CarrierLineRef | null; forced: boolean }): CarrierMode {
  if (market.forced) return "forced";
  return market.preference ? "preferred" : "auto";
}

/** True when a cell ships on another line than the market's 1-unit line. */
export function cellUsesOtherLine(
  cell: Pick<CogsMatrixCellView, "carrier" | "lineName">,
  line: CarrierLineRef | null,
) {
  if (!cell.carrier || !line) return false;
  return lineKey(cell.carrier, cell.lineName) !== lineKey(line.carrier, line.lineName);
}

/** COGS matrix + carrier selector views of a product matrix (client page and staff sheet). */
export function matrixViews(matrix: MatrixLike) {
  const matrixMarkets: CogsMatrixMarketView[] = matrix.markets.map((market) => {
    const single = market.cells.find((cell) => cell.quantity === 1)?.breakdown ?? null;
    return {
      destination: market.destination,
      line: single ? { carrier: single.carrier, lineName: single.lineName } : null,
      deliveryRange: single?.deliveryRange ?? null,
      mode: carrierModeOf(market),
      fallback: single?.selectionReason === "fallback_preferred_unavailable",
      cells: market.cells.map((cell) => ({
        quantity: cell.quantity,
        cogs: cell.breakdown?.cogs ?? null,
        cogsPerUnit: cell.breakdown?.cogsPerUnit ?? null,
        weightG: cell.breakdown?.weightG ?? null,
        billedWeightG: cell.breakdown?.billedWeightG ?? null,
        iossRequired: cell.breakdown?.iossRequired === true,
        carrier: cell.breakdown?.carrier ?? null,
        lineName: cell.breakdown?.lineName ?? null,
        weightMinG: cell.breakdown?.weightMinG ?? null,
        weightMaxG: cell.breakdown?.weightMaxG ?? null,
        shipping: cell.breakdown?.shipping ?? null,
        deliveryRange: cell.breakdown?.deliveryRange ?? null,
        contentWeightG: cell.breakdown?.contentWeightG ?? null,
        packagingWeightG: cell.breakdown?.packagingWeightG ?? null,
        coveredCogs: cell.covered?.cogs ?? null,
        coveredLine: cell.covered ? { carrier: cell.covered.carrier, lineName: cell.covered.lineName } : null,
      })),
    };
  });
  const carrierMarkets: CarrierSelectorMarket[] = matrix.markets.map((market) => {
    const single = market.cells.find((cell) => cell.quantity === 1)?.breakdown ?? null;
    return {
      destination: market.destination,
      options: market.options,
      preference: market.preference,
      forced: market.forced,
      selectionReason: single?.selectionReason ?? null,
      autoLine: !market.preference && single ? { carrier: single.carrier, lineName: single.lineName } : null,
      limitedLines: market.options
        .filter((option) => isLimitedCoverageCarrier(option.carrier, market.autoCarriers))
        .map((option) => lineKey(option.carrier, option.lineName)),
    };
  });
  return { matrixMarkets, carrierMarkets };
}
