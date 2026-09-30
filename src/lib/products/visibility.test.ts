import { describe, expect, it } from "vitest";
import {
  assertNoInternalProductFields,
  serializeClientProduct,
} from "./visibility";

describe("client product visibility", () => {
  it("drops supplier and factory fields", () => {
    const serialized = serializeClientProduct({
      id: "product",
      title: "Visible",
      factory_purchase_price: 1,
      supplier_name: "Hidden supplier",
      supplier_contact: "hidden@example.com",
    });
    expect(serialized.title).toBe("Visible");
    expect(serialized).not.toHaveProperty("factory_purchase_price");
    expect(serialized).not.toHaveProperty("supplier_name");
    expect(assertNoInternalProductFields(serialized as unknown as Record<string, unknown>)).toBe(
      true,
    );
  });
});
