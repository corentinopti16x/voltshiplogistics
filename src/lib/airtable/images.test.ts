import { describe, expect, it } from "vitest";
import {
  isTemporaryAirtableImage,
  productImagesFromAirtableFields,
  readAirtableImages,
} from "./images";

describe("Airtable product images", () => {
  it("reads a photo URL and ignores other text", () => {
    expect(readAirtableImages("https://cdn.shopify.com/photo.jpg")).toEqual([
      { url: "https://cdn.shopify.com/photo.jpg", id: "https://cdn.shopify.com/photo.jpg" },
    ]);
    expect(readAirtableImages("see the drive folder")).toEqual([]);
  });

  it("reads Airtable attachment objects", () => {
    expect(
      readAirtableImages([
        {
          id: "att123",
          url: "https://v5.airtableusercontent.com/full.jpg",
          thumbnails: { large: { url: "https://v5.airtableusercontent.com/large.jpg" } },
        },
      ]),
    ).toEqual([
      { url: "https://v5.airtableusercontent.com/full.jpg", id: "att123" },
    ]);
  });

  it("uses another attachment column when Photo URL is empty", () => {
    expect(
      productImagesFromAirtableFields(
        {
          "Photo URL": "",
          "Photos du produit": [
            { id: "att9", url: "https://v5.airtableusercontent.com/product.jpg" },
          ],
        },
        "Photo URL",
      ),
    ).toEqual([
      { url: "https://v5.airtableusercontent.com/product.jpg", id: "att9" },
    ]);
  });

  it("recognizes expiring Airtable file hosts", () => {
    expect(isTemporaryAirtableImage("https://v5.airtableusercontent.com/a.jpg")).toBe(true);
    expect(isTemporaryAirtableImage("https://cdn.shopify.com/a.jpg")).toBe(false);
  });
});