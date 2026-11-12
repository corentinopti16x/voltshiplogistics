import { describe, expect, it } from "vitest";
import { queuePosition } from "./queue-core";

const queue = [
  { id: "a", title: "A" },
  { id: "b", title: "B" },
  { id: "c", title: "C" },
];

describe("queuePosition", () => {
  it("gives the position and both neighbours", () => {
    expect(queuePosition(queue, "b")).toEqual({
      position: 2,
      total: 3,
      previous: queue[0],
      next: queue[2],
    });
  });

  it("has no previous at the start and no next at the end", () => {
    expect(queuePosition(queue, "a").previous).toBeNull();
    expect(queuePosition(queue, "c").next).toBeNull();
  });

  it("points to the first product to quote when this one is already quoted", () => {
    expect(queuePosition(queue, "z")).toEqual({
      position: null,
      total: 3,
      previous: null,
      next: queue[0],
    });
  });
});
