import { describe, expect, it } from "vitest";
import {
  clientNote,
  packPieces,
  parseClientNote,
  parsePackPieces,
  piecesToShip,
  withSheetExtras,
} from "./extras";

describe("packPieces", () => {
  it("defaults to 1 and reads valid sets", () => {
    expect(packPieces(null)).toBe(1);
    expect(packPieces({})).toBe(1);
    expect(packPieces({ pack_pieces: 2 })).toBe(2);
    expect(packPieces({ pack_pieces: "3" })).toBe(3);
    expect(packPieces({ pack_pieces: 0 })).toBe(1);
    expect(packPieces({ pack_pieces: 1.5 })).toBe(1);
  });

  it("parses the form value", () => {
    expect(parsePackPieces("")).toBe(1);
    expect(parsePackPieces("2")).toBe(2);
    expect(parsePackPieces("0")).toBeNull();
    expect(parsePackPieces("2.5")).toBeNull();
    expect(parsePackPieces("51")).toBeNull();
  });

  it("multiplies units sold by the set size for the warehouse", () => {
    expect(piecesToShip(3, { pack_pieces: 2 })).toBe(6);
    expect(piecesToShip(3, null)).toBe(3);
  });
});

describe("client note", () => {
  it("reads and normalises the note", () => {
    expect(clientNote({})).toBeNull();
    expect(clientNote({ client_note: "  " })).toBeNull();
    expect(clientNote({ client_note: "Set de 2", client_note_at: "2026-10-10T06:00:00.000Z" })).toEqual({
      text: "Set de 2",
      at: "2026-10-10T06:00:00.000Z",
    });
    expect(parseClientNote("  hello\r\nworld ")).toBe("hello\nworld");
    expect(parseClientNote("")).toBeNull();
    expect(parseClientNote("x".repeat(3000))?.length).toBe(2000);
  });

  it("dates a new note and keeps the date when the text is unchanged", () => {
    const now = new Date("2026-10-10T07:00:00.000Z");
    const first = withSheetExtras({ _request: {} }, { batteryInternal: false, packPieces: 2, clientNote: "Set de 2" }, now);
    expect(first.noteChanged).toBe(true);
    expect(first.quote).toMatchObject({
      _request: {},
      battery_internal: false,
      pack_pieces: 2,
      client_note: "Set de 2",
      client_note_at: now.toISOString(),
    });
    const later = new Date("2026-10-12T07:00:00.000Z");
    const again = withSheetExtras(first.quote, { batteryInternal: true, packPieces: 2, clientNote: "Set de 2" }, later);
    expect(again.noteChanged).toBe(false);
    expect(again.quote.client_note_at).toBe(now.toISOString());
    const cleared = withSheetExtras(again.quote, { batteryInternal: true, packPieces: 1, clientNote: null }, later);
    expect(cleared.noteChanged).toBe(false);
    expect(cleared.quote.client_note).toBeNull();
    expect(cleared.quote.client_note_at).toBeNull();
  });
});
