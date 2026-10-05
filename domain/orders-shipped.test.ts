import { describe, expect, it } from "vitest";
import { countOrderWindows } from "./orders-shipped";

describe("orders shipped windows", () => {
  const now = new Date(2026, 8, 27, 15, 0, 0);

  it("counts today inside 7 days and 30 days", () => {
    expect(countOrderWindows(["2026-09-27", "2026-09-27"], now)).toEqual({
      today: 2,
      week: 2,
      month: 2,
    });
  });

  it("keeps older orders in the wider windows only", () => {
    expect(
      countOrderWindows(["2026-09-21", "2026-08-29", "2026-08-28"], now),
    ).toEqual({
      today: 0,
      week: 1,
      month: 2,
    });
  });
});
