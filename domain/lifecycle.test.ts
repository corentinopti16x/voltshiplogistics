import { describe, expect, it } from "vitest";
import { classifyLifecycle } from "./lifecycle";

const now = new Date("2026-09-21T12:00:00Z");
const sale = (daysAgo: number, units: number) => ({
  date: new Date(now.getTime() - daysAgo * 86400000).toISOString().slice(0, 10),
  units,
});

describe("lifecycle classification", () => {
  it("marks sustained velocity as winning", () => {
    expect(
      classifyLifecycle({
        current: "testing",
        createdDate: "2026-08-01",
        now,
        sales: Array.from({ length: 14 }, (_, day) => sale(day, 6)),
      }),
    ).toBe("winning");
  });

  it("marks a 50 percent drop as declining", () => {
    const sales = [
      ...Array.from({ length: 14 }, (_, day) => sale(day, 2)),
      ...Array.from({ length: 14 }, (_, day) => sale(day + 14, 6)),
    ];
    expect(
      classifyLifecycle({
        current: "winning",
        createdDate: "2026-01-01",
        now,
        sales,
      }),
    ).toBe("declining");
  });

  it("marks ninety days without sales as dead", () => {
    expect(
      classifyLifecycle({
        current: "declining",
        createdDate: "2026-01-01",
        now,
        sales: [sale(91, 1)],
      }),
    ).toBe("dead");
  });

  it("never reclassifies archived products", () => {
    expect(
      classifyLifecycle({
        current: "archived",
        createdDate: "2026-01-01",
        now,
        sales: [],
      }),
    ).toBe("archived");
  });
});
