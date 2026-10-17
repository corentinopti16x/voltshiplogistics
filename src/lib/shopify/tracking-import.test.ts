import { describe, expect, it } from "vitest";
import {
  chunkRows,
  normalizeCompany,
  normalizeOrderName,
  normalizeShopifyOrderId,
  parseCsv,
  parseTrackingFile,
  sanitizeTrackingRows,
  trackingUrlFor,
} from "./tracking-import";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, separators and newlines inside quotes", () => {
    expect(parseCsv('a,b,c\n"x, y","say ""hi""","line\nbreak"\r\n1,2,3')).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line\nbreak"],
      ["1", "2", "3"],
    ]);
  });

  it("detects semicolons and tabs", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("normalizers", () => {
  it("keeps the Shopify order number of a name", () => {
    expect(normalizeOrderName("#14236")).toBe("14236");
    expect(normalizeOrderName("ECDF#14236")).toBe("14236");
    expect(normalizeOrderName("abc")).toBeNull();
  });

  it("accepts only exact numeric order ids", () => {
    expect(normalizeShopifyOrderId("8272336093523")).toBe("8272336093523");
    expect(normalizeShopifyOrderId("gid://shopify/Order/8272336093523")).toBe("8272336093523");
    expect(normalizeShopifyOrderId("8.27234E+12")).toBeNull();
  });

  it("names carriers like Shopify and links the others to 17TRACK", () => {
    expect(normalizeCompany("yunexpress")).toBe("YunExpress");
    expect(normalizeCompany("Other")).toBeNull();
    expect(normalizeCompany("XYY")).toBe("XYY");
    expect(trackingUrlFor("YunExpress", "YT1")).toBeNull();
    expect(trackingUrlFor("XYY", "XYYEX0041160956YQ")).toBe("https://t.17track.net/en#nums=XYYEX0041160956YQ");
    expect(trackingUrlFor(null, "92197904")).toContain("17track");
  });
});

describe("parseTrackingFile", () => {
  const ours =
    "﻿Order Name,Shopify Order ID,Tracking Number,Tracking Company,Notify Customer,ECCANG Order,Lot\n" +
    "#14236,8272336093523,YT2628600709437318,YunExpress,TRUE,C000121-261013-0293,PL0012610130001\n" +
    "#14237,8272341631315,YT2628600709437319,YunExpress,TRUE,C000121-261013-0294,PL0012610130001\n" +
    "#14237,8272341631315,YT2628600709437319,YunExpress,TRUE,C000121-261013-0294,PL0012610130001\n" +
    "#14238,,,YunExpress,TRUE,,\n" +
    ",,YT2628600709437320,YunExpress,TRUE,,\n";

  it("reads our Matrixify-style file", () => {
    const result = parseTrackingFile(ours);
    expect(result.missingColumns).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 2,
        orderName: "14236",
        shopifyOrderId: "8272336093523",
        trackingNumber: "YT2628600709437318",
        company: "YunExpress",
      },
      {
        line: 3,
        orderName: "14237",
        shopifyOrderId: "8272341631315",
        trackingNumber: "YT2628600709437319",
        company: "YunExpress",
      },
    ]);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toEqual([
      { line: 5, reason: "no_tracking" },
      { line: 6, reason: "no_order" },
    ]);
  });

  it("reads a French file with only the order name", () => {
    const result = parseTrackingFile("Commande;Numéro de suivi;Transporteur\n#11868;XYYEX0041095377YQ;XYY\n");
    expect(result.rows).toEqual([
      { line: 2, orderName: "11868", shopifyOrderId: null, trackingNumber: "XYYEX0041095377YQ", company: "XYY" },
    ]);
  });

  it("reports the missing columns", () => {
    expect(parseTrackingFile("foo,bar\n1,2").missingColumns).toEqual(["order", "tracking"]);
    expect(parseTrackingFile("Order Name,foo\n#1,2").missingColumns).toEqual(["tracking"]);
  });
});

describe("chunkRows / sanitizeTrackingRows", () => {
  it("splits in chunks", () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("rejects malformed rows from the browser", () => {
    const row = { line: 2, orderName: "14236", shopifyOrderId: "8272336093523", trackingNumber: "YT2628600709437318", company: "yunexpress" };
    expect(sanitizeTrackingRows([row])).toEqual([{ ...row, company: "YunExpress" }]);
    expect(sanitizeTrackingRows([{ ...row, trackingNumber: "" }])).toBeNull();
    expect(sanitizeTrackingRows([])).toBeNull();
    expect(sanitizeTrackingRows(new Array(21).fill(row))).toBeNull();
    expect(sanitizeTrackingRows("x")).toBeNull();
  });
});
