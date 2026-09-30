import { describe, expect, it } from "vitest";
import {
  destinationForRole,
  isClientRole,
  isInternalRole,
  roleBelongsToPortal,
} from "./portals";

describe("auth portals", () => {
  it("sends client roles to the client dashboard", () => {
    expect(isClientRole("owner")).toBe(true);
    expect(isClientRole("staff")).toBe(true);
    expect(isInternalRole("owner")).toBe(false);
    expect(destinationForRole("owner")).toBe("/dashboard");
    expect(roleBelongsToPortal("staff", "client")).toBe(true);
    expect(roleBelongsToPortal("staff", "staff")).toBe(false);
  });

  it("sends Voltship staff to the internal console", () => {
    expect(isInternalRole("voltship_admin")).toBe(true);
    expect(isInternalRole("sourcer")).toBe(true);
    expect(destinationForRole("voltship_admin")).toBe("/admin");
    expect(destinationForRole("sourcer")).toBe("/sourcer");
    expect(roleBelongsToPortal("voltship_admin", "staff")).toBe(true);
    expect(roleBelongsToPortal("voltship_admin", "client")).toBe(false);
  });
});
