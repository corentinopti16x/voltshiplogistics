import { describe, expect, it } from "vitest";
import {
  effectiveGridVersion,
  isoToShanghaiLocal,
  parseGridSchedule,
  scheduleIsDue,
  serializeGridSchedule,
  shanghaiLocalToIso,
} from "./grid-schedule";

describe("scheduled grid activation", () => {
  it("converts China time to UTC and back", () => {
    expect(shanghaiLocalToIso("2026-10-12T09:00")).toBe("2026-10-12T01:00:00.000Z");
    expect(isoToShanghaiLocal("2026-10-12T01:00:00.000Z")).toBe("2026-10-12 09:00");
    expect(shanghaiLocalToIso("nope")).toBeNull();
  });

  it("switches the grid at the scheduled time", () => {
    const schedule = parseGridSchedule(
      serializeGridSchedule({ gridVersion: "V3-2026-10-12", at: "2026-10-12T01:00:00.000Z", by: "u1" }),
    );
    expect(schedule?.gridVersion).toBe("V3-2026-10-12");
    const before = new Date("2026-10-12T00:59:00.000Z");
    const after = new Date("2026-10-12T01:00:00.000Z");
    expect(scheduleIsDue(schedule, before)).toBe(false);
    expect(effectiveGridVersion("V3-2026-10-10", schedule, before)).toBe("V3-2026-10-10");
    expect(effectiveGridVersion("V3-2026-10-10", schedule, after)).toBe("V3-2026-10-12");
    expect(effectiveGridVersion("uninitialized", null)).toBeNull();
    expect(parseGridSchedule("{bad")).toBeNull();
  });
});
