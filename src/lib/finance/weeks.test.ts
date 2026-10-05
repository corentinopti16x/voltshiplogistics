import { describe, expect, it } from "vitest";
import {
  addDays,
  breakEven,
  buildFinanceWeek,
  fixedCostsForWeek,
  isValidDateString,
  isoWeekNumber,
  listWeeks,
  parisDateOf,
  parisMidnightIso,
  prorateFixedCost,
  sumAdjustments,
  weekBoundsIso,
  weekEndOf,
  weekStartOf,
  weekStartOfDate,
  WEEKS_PER_MONTH,
  type FinanceAdjustment,
  type FixedCost,
} from "./weeks";

describe("week bucketing (Europe/Paris, ISO weeks)", () => {
  it("maps calendar dates to their Monday", () => {
    expect(weekStartOfDate("2026-10-05")).toBe("2026-10-05"); // Monday
    expect(weekStartOfDate("2026-10-08")).toBe("2026-10-05"); // Thursday
    expect(weekStartOfDate("2026-10-11")).toBe("2026-10-05"); // Sunday stays in the week
    expect(weekStartOfDate("2026-10-12")).toBe("2026-10-12"); // next Monday
    expect(weekEndOf("2026-10-05")).toBe("2026-10-11");
  });

  it("uses the Paris calendar date, not UTC, around midnight", () => {
    // Sunday 11 Oct 2026 23:30 UTC = Monday 12 Oct 01:30 Paris (CEST, +2) → next week.
    expect(parisDateOf("2026-10-11T23:30:00.000Z")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-11T23:30:00.000Z")).toBe("2026-10-12");
    // Sunday 21:00 UTC = Sunday 23:00 Paris → still the week of the 5th.
    expect(weekStartOf("2026-10-11T21:00:00.000Z")).toBe("2026-10-05");
    // Winter (CET, +1): Sunday 23:30 UTC = Monday 00:30 Paris.
    expect(weekStartOf("2026-01-11T23:30:00.000Z")).toBe("2026-01-12");
  });

  it("computes week bounds as Paris midnight instants, across the DST switch", () => {
    expect(parisMidnightIso("2026-07-06")).toBe("2026-07-05T22:00:00.000Z"); // CEST
    expect(parisMidnightIso("2026-01-05")).toBe("2026-01-04T23:00:00.000Z"); // CET
    // Week of 26 Oct 2026: DST ends Sunday 25 Oct → Monday 26 is already CET.
    const bounds = weekBoundsIso("2026-10-19");
    expect(bounds.since).toBe("2026-10-18T22:00:00.000Z");
    expect(bounds.until).toBe("2026-10-25T23:00:00.000Z");
  });

  it("lists weeks ascending and ends with the given one", () => {
    expect(listWeeks("2026-10-05", 3)).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("numbers ISO weeks", () => {
    expect(isoWeekNumber("2026-10-05")).toBe(41);
    expect(isoWeekNumber("2025-12-29")).toBe(1); // ISO week 1 of 2026 starts in Dec 2025
    expect(isoWeekNumber("2026-01-05")).toBe(2);
  });

  it("validates date strings", () => {
    expect(isValidDateString("2026-10-05")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("05/10/2026")).toBe(false);
  });
});

describe("fixed cost proration", () => {
  const monthly: FixedCost = {
    id: "1",
    label: "Loyer",
    amountEur: 5200,
    period: "monthly",
    startDate: "2026-10-08",
    endDate: null,
    category: "loyer",
    notes: null,
  };

  it("prorates monthly costs at 12/52 per week while active", () => {
    expect(prorateFixedCost(monthly, "2026-10-05")).toBeCloseTo(5200 * WEEKS_PER_MONTH, 6); // starts Thursday → active
    expect(prorateFixedCost(monthly, "2026-09-28")).toBe(0); // before start
    expect(prorateFixedCost({ ...monthly, endDate: "2026-10-20" }, "2026-10-19")).toBeCloseTo(1200, 6); // overlaps end
    expect(prorateFixedCost({ ...monthly, endDate: "2026-10-18" }, "2026-10-19")).toBe(0); // ended
  });

  it("counts weekly costs as-is and one-offs in their week only", () => {
    expect(prorateFixedCost({ ...monthly, period: "weekly", amountEur: 300 }, "2026-10-05")).toBe(300);
    const oneOff = { ...monthly, period: "one_off" as const, amountEur: 900, startDate: "2026-10-11" };
    expect(prorateFixedCost(oneOff, "2026-10-05")).toBe(900); // Sunday of that week
    expect(prorateFixedCost(oneOff, "2026-10-12")).toBe(0);
    expect(prorateFixedCost(oneOff, "2026-09-28")).toBe(0);
  });

  it("sums per category with cents rounding", () => {
    const costs: FixedCost[] = [
      monthly,
      { ...monthly, id: "2", label: "WMS", amountEur: 130, category: "outils" },
      { ...monthly, id: "3", label: "Salaire", amountEur: 2600, category: "salaires", startDate: "2026-11-01" },
    ];
    const week = fixedCostsForWeek(costs, "2026-10-12");
    expect(week.total).toBe(1230);
    expect(week.byCategory).toEqual({ loyer: 1200, outils: 30 });
    expect(week.byCategory.salaires).toBeUndefined();
  });
});

describe("adjustments", () => {
  const adjustments: FinanceAdjustment[] = [
    { id: "a", weekStart: "2026-10-05", label: "Bonus client", amountEur: 150, kind: "revenue", notes: null },
    { id: "b", weekStart: "2026-10-05", label: "Colis abîmé", amountEur: 42.5, kind: "cost", notes: null },
    { id: "c", weekStart: "2026-10-05", label: "Avoir transporteur", amountEur: -10, kind: "cost", notes: null },
    { id: "d", weekStart: "2026-09-28", label: "Autre semaine", amountEur: 999, kind: "revenue", notes: null },
  ];

  it("sums signed amounts by kind for the week only", () => {
    expect(sumAdjustments(adjustments, "2026-10-05")).toEqual({ revenue: 150, cost: 32.5 });
    expect(sumAdjustments(adjustments, "2026-10-12")).toEqual({ revenue: 0, cost: 0 });
  });
});

describe("break-even", () => {
  it("divides fixed costs by the margin per parcel, then per day and per working day", () => {
    expect(breakEven(1400, 4)).toEqual({ parcelsPerWeek: 350, perDay: 50, perWorkingDay: 70 });
    expect(breakEven(1000, 3)).toEqual({ parcelsPerWeek: 333.3, perDay: 47.6, perWorkingDay: 66.7 });
  });

  it("is null without parcels or with a non-positive margin", () => {
    const none = { parcelsPerWeek: null, perDay: null, perWorkingDay: null };
    expect(breakEven(1400, null)).toEqual(none);
    expect(breakEven(1400, 0)).toEqual(none);
    expect(breakEven(1400, -2)).toEqual(none);
  });
});

describe("buildFinanceWeek", () => {
  const fixedCosts: FixedCost[] = [
    { id: "1", label: "Loyer", amountEur: 5200, period: "monthly", startDate: "2026-01-01", endDate: null, category: "loyer", notes: null },
  ];
  const parcel = (clientId: string, revenue: number, cost: number, complete = true) => ({
    clientId,
    clientName: clientId.toUpperCase(),
    figure: { clientId, clientName: clientId.toUpperCase(), revenue, cost, margin: revenue - cost, complete },
  });

  it("computes revenue, variable costs, gross margin, fixed, result, break-even and the client split", () => {
    const week = buildFinanceWeek({
      weekStart: "2026-10-05",
      source: "eccang",
      parcels: [
        parcel("a", 20, 12),
        parcel("a", 30, 18, false),
        parcel("b", 25, 15),
        { clientId: "b", clientName: "B", figure: null },
      ],
      fixedCosts,
      adjustments: [
        { id: "x", weekStart: "2026-10-05", label: "Bonus", amountEur: 10, kind: "revenue", notes: null },
        { id: "y", weekStart: "2026-10-05", label: "Casse", amountEur: 5, kind: "cost", notes: null },
      ],
      computedAt: "2026-10-05T10:00:00.000Z",
    });
    expect(week.parcels).toBe(4);
    expect(week.pricedParcels).toBe(3);
    expect(week.incompleteParcels).toBe(1);
    expect(week.revenue).toEqual({ parcels: 75, adjustments: 10, total: 85 });
    expect(week.variableCosts).toEqual({ parcels: 45, adjustments: 5, total: 50 });
    expect(week.grossMargin).toBe(35);
    expect(week.marginPerParcel).toBe(10); // (8 + 12 + 10) / 3, adjustments excluded
    expect(week.fixedCosts.total).toBe(1200);
    expect(week.result).toBe(-1165);
    expect(week.breakEven).toEqual({ parcelsPerWeek: 120, perDay: 17.1, perWorkingDay: 24 });
    expect(week.estimated).toBe(false);
    expect(week.isoWeek).toBe(41);
    expect(week.byClient).toEqual([
      { clientId: "a", clientName: "A", parcels: 2, unpriced: 0, revenue: 50, cost: 30, margin: 20 },
      { clientId: "b", clientName: "B", parcels: 2, unpriced: 1, revenue: 25, cost: 15, margin: 10 },
    ]);
  });

  it("flags Shopify-based weeks as estimated and handles empty weeks", () => {
    const estimated = buildFinanceWeek({
      weekStart: "2026-10-05",
      source: "shopify_estimate",
      parcels: [parcel("a", 20, 12)],
      fixedCosts: [],
      adjustments: [],
    });
    expect(estimated.estimated).toBe(true);
    expect(estimated.result).toBe(8);
    expect(estimated.breakEven.parcelsPerWeek).toBe(0);

    const empty = buildFinanceWeek({ weekStart: "2026-10-05", source: "none", parcels: [], fixedCosts, adjustments: [] });
    expect(empty.marginPerParcel).toBeNull();
    expect(empty.result).toBe(-1200);
    expect(empty.breakEven.perDay).toBeNull();
  });
});
