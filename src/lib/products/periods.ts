export const SALES_PERIODS = [7, 30, 90] as const;
export type SalesPeriod = (typeof SALES_PERIODS)[number];

export function parseSalesPeriod(raw: string | undefined): SalesPeriod {
  const value = Number(raw);
  return (SALES_PERIODS as readonly number[]).includes(value) ? (value as SalesPeriod) : 90;
}
