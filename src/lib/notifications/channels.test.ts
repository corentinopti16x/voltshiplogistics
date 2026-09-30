import { describe, expect, it } from "vitest";
import { allowedChannels } from "./channels";

describe("notification channels", () => {
  it("keeps requested channels when nobody saved a preference", () => {
    expect(allowedChannels(["in_app", "email", "whatsapp"], [])).toEqual([
      "in_app",
      "email",
      "whatsapp",
    ]);
  });

  it("drops a channel when any owner turned it off", () => {
    expect(
      allowedChannels(
        ["in_app", "email", "whatsapp"],
        [
          { in_app: true, email: false, whatsapp: true },
          null,
        ],
      ),
    ).toEqual(["in_app", "whatsapp"]);
  });
});
