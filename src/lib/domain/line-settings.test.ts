import { describe, expect, it } from "vitest";
import {
  cleanSettingText,
  dropPendingLines,
  lineSettingKey,
  pendingLineKeys,
  type LineSetting,
} from "./line-settings";

const setting = (over: Partial<LineSetting>): LineSetting => ({
  destination: "US",
  carrier: "YunExpress",
  lineName: "商派特惠普货 YTSPTHPH",
  status: "pending",
  eccangMethod: null,
  deliveryDays: null,
  note: null,
  updatedAt: null,
  ...over,
});

describe("line settings", () => {
  it("builds the same key whatever the case and the spaces", () => {
    expect(lineSettingKey(" us ", "YunExpress ", " THZXR")).toBe(
      lineSettingKey("US", "yunexpress", "thzxr"),
    );
    expect(lineSettingKey("US", "Tongyou", null)).toBe("US|tongyou|");
  });

  it("drops only the brackets of pending lines, in their own country", () => {
    const pending = pendingLineKeys([
      setting({}),
      setting({ lineName: "THZXR", status: "active" }),
    ]);
    const cells = [
      {
        destination: "US",
        carrier: "YunExpress",
        lineName: "商派特惠普货 YTSPTHPH",
      },
      { destination: "US", carrier: "YunExpress", lineName: "THZXR" },
      {
        destination: "CA",
        carrier: "YunExpress",
        lineName: "商派特惠普货 YTSPTHPH",
      },
    ];
    expect(
      dropPendingLines(cells, pending).map(
        (cell) => `${cell.destination} ${cell.lineName}`,
      ),
    ).toEqual(["US THZXR", "CA 商派特惠普货 YTSPTHPH"]);
  });

  it("returns the same array when nothing is pending", () => {
    const cells = [
      { destination: "US", carrier: "YunExpress", lineName: "THZXR" },
    ];
    expect(dropPendingLines(cells, new Set())).toBe(cells);
  });

  it("cleans free text and refuses what is too long or not text", () => {
    expect(cleanSettingText("  Hors zone :  repasser   en THZXR ")).toEqual({
      ok: true,
      value: "Hors zone : repasser en THZXR",
    });
    expect(cleanSettingText("   ")).toEqual({ ok: true, value: null });
    expect(cleanSettingText(null)).toEqual({ ok: true, value: null });
    expect(cleanSettingText("x".repeat(301))).toEqual({ ok: false });
    expect(cleanSettingText(12)).toEqual({ ok: false });
  });
});
