import { describe, expect, it } from "vitest";
import { findDuplicateGroups, shopifyCarrierFor, type DuplicateCandidate } from "./duplicates";

const row = (id: string, ref: string | null, status: string, created = "2026-10-13T10:00:00Z", tracking: string | null = null): DuplicateCandidate => ({
  id,
  external_ref: ref,
  eccang_order_code: `C-${id}`,
  status,
  eccang_created_at: created,
  tracking_no: tracking,
});

describe("anti-doublon ECCANG", () => {
  it("ignores single orders, cancelled copies and non-Shopify references", () => {
    expect(
      findDuplicateGroups([
        row("a", "8205743325523", "W"),
        row("b", "8205743325523", "X"),
        row("c", "MY-ERP-1", "W"),
        row("d", "MY-ERP-1", "W"),
        row("e", null, "W"),
      ]),
    ).toEqual([]);
  });

  it("keeps the shipped copy and cancels the one still waiting", () => {
    const [group] = findDuplicateGroups([
      row("shopify", "8207201403219", "W", "2026-10-23T10:00:00Z"),
      row("import", "8207201403219", "D", "2026-10-13T10:00:00Z", "YT2629300706172575"),
    ]);
    expect(group.keep.id).toBe("import");
    expect(group.toCancel.map((r) => r.id)).toEqual(["shopify"]);
    expect(group.shippedTwice).toEqual([]);
  });

  it("keeps the copy furthest in the flow, then the oldest", () => {
    const [group] = findDuplicateGroups([
      row("anomaly", "8202492870995", "N", "2026-10-22T10:00:00Z"),
      row("waiting", "8202492870995", "W", "2026-10-13T10:00:00Z"),
      row("waiting-late", "8202492870995", "W", "2026-10-20T10:00:00Z"),
    ]);
    expect(group.keep.id).toBe("waiting");
    expect(group.toCancel.map((r) => r.id).sort()).toEqual(["anomaly", "waiting-late"]);
  });

  it("flags a double shipment", () => {
    const [group] = findDuplicateGroups([
      row("one", "8217415516499", "D", "2026-10-13T10:00:00Z", "YT2629300706156560"),
      row("two", "8217415516499", "D", "2026-10-16T10:00:00Z", "YT2629300702170425"),
    ]);
    expect(group.keep.id).toBe("one");
    expect(group.shippedTwice.map((r) => r.tracking_no)).toEqual(["YT2629300702170425"]);
    expect(group.toCancel).toEqual([]);
  });

  it("names the carrier for Shopify", () => {
    expect(shopifyCarrierFor("YT2629300706156560", "YUNWAYV2")).toBe("YunExpress");
    expect(shopifyCarrierFor("LX123", "Other")).toBeNull();
    expect(shopifyCarrierFor("LX123", "Tongyou")).toBe("Tongyou");
  });
});
