import { describe, expect, it } from "vitest";
import {
  computeClientRecurrence,
  computeProductRecurrence,
  type RecurrenceOrder,
} from "./recurrence";

// 5 customers (A–E) + one order without a customer key.
const orders: RecurrenceOrder[] = [
  { date: "2026-07-10", cancelled: false, customerKey: "A", skus: ["LAMP"] },
  { date: "2026-07-20", cancelled: false, customerKey: "A", skus: ["MUG"] },
  { date: "2026-09-01", cancelled: false, customerKey: "A", skus: ["LAMP"] },
  { date: "2026-07-12", cancelled: false, customerKey: "B", skus: ["LAMP"] },
  { date: "2026-08-11", cancelled: false, customerKey: "B", skus: ["LAMP"] },
  { date: "2026-07-15", cancelled: false, customerKey: "C", skus: ["LAMP"] },
  { date: "2026-09-20", cancelled: false, customerKey: "C", skus: ["MUG"] },
  { date: "2026-08-01", cancelled: false, customerKey: "D", skus: ["MUG"] },
  { date: "2026-08-02", cancelled: true, customerKey: "D", skus: ["MUG"] },
  { date: "2026-08-05", cancelled: false, customerKey: "E", skus: ["LAMP"] },
  { date: "2026-08-06", cancelled: false, customerKey: null, skus: ["LAMP"] },
];

const today = new Date("2026-10-04T12:00:00Z");

describe("client recurrence", () => {
  it("computes repeat rate, orders per customer and returning share without cancelled orders", () => {
    const result = computeClientRecurrence(orders, today);
    expect(result.ordersTotal).toBe(10);
    expect(result.ordersWithCustomer).toBe(9);
    expect(result.customers).toBe(5);
    expect(result.repeatCustomers).toBe(3); // A, B, C
    expect(result.repeatRate).toBeCloseTo(3 / 5);
    expect(result.ordersPerCustomer).toBeCloseTo(9 / 5);
    // Returning orders: A has 2 extra, B 1, C 1 → 4 of 9 keyed orders.
    expect(result.returningOrderShare).toBeCloseTo(4 / 9);
  });

  it("takes the median gap between the first and second order", () => {
    const result = computeClientRecurrence(orders, today);
    // A: 10 days, B: 30 days, C: 67 days → median 30.
    expect(result.medianDaysToSecondOrder).toBe(30);
  });

  it("reports the window covered by the cached orders", () => {
    const result = computeClientRecurrence(orders, today);
    expect(result.firstOrderDate).toBe("2026-07-10");
    expect(result.lastOrderDate).toBe("2026-09-20");
    expect(result.windowDays).toBe(87);
  });

  it("is honest when there is nothing to measure", () => {
    const result = computeClientRecurrence([], today);
    expect(result).toMatchObject({
      ordersTotal: 0,
      customers: 0,
      repeatRate: null,
      ordersPerCustomer: null,
      medianDaysToSecondOrder: null,
      returningOrderShare: null,
      windowDays: 0,
    });
    const anonymous = computeClientRecurrence(
      [{ date: "2026-09-01", cancelled: false, customerKey: null, skus: ["X"] }],
      today,
    );
    expect(anonymous.ordersTotal).toBe(1);
    expect(anonymous.customers).toBe(0);
    expect(anonymous.repeatRate).toBeNull();
  });
});

describe("product recurrence", () => {
  it("counts buyers who re-ordered anything within the window", () => {
    // LAMP buyers: A (re-ordered MUG 10 days later), B (30 days), C (MUG after 67 days → no),
    // E (never). The keyless order is ignored.
    const result = computeProductRecurrence(orders, "LAMP", 60);
    expect(result.buyers).toBe(4);
    expect(result.reorderers).toBe(2);
    expect(result.reorderRate).toBeCloseTo(0.5);
  });

  it("starts the window at the first order containing the SKU", () => {
    // MUG: A bought it on 07-20 then re-ordered 09-01 (43 days → yes); C bought it on 09-20
    // (nothing after); D's only later order is cancelled.
    const result = computeProductRecurrence(orders, "MUG", 60);
    expect(result.buyers).toBe(3);
    expect(result.reorderers).toBe(1);
  });

  it("returns null without buyers", () => {
    expect(computeProductRecurrence(orders, "NOPE").reorderRate).toBeNull();
  });
});
