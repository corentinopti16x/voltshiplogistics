export type AirtableImage = {
  url: string;
  id: string;
};

function httpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function uniqueImages(images: AirtableImage[]) {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (seen.has(image.id)) return false;
    seen.add(image.id);
    return true;
  });
}

export function readAirtableImages(value: unknown): AirtableImage[] {
  if (typeof value === "string") {
    return uniqueImages(
      value
        .split(/\s+/)
        .map((part) => httpUrl(part))
        .filter((url): url is string => Boolean(url))
        .map((url) => ({ url, id: url })),
    );
  }

  if (Array.isArray(value)) {
    const images: AirtableImage[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") {
        const url = httpUrl(item);
        if (url) images.push({ url, id: url });
        continue;
      }
      const row = item as {
        id?: unknown;
        url?: unknown;
        thumbnails?: { large?: { url?: unknown }; full?: { url?: unknown } };
      };
      const url =
        httpUrl(row.url) ??
        httpUrl(row.thumbnails?.large?.url) ??
        httpUrl(row.thumbnails?.full?.url);
      if (!url) continue;
      images.push({
        url,
        id: typeof row.id === "string" && row.id ? row.id : url,
      });
    }
    return uniqueImages(images);
  }

  if (value && typeof value === "object") return readAirtableImages([value]);
  return [];
}

export function productImagesFromAirtableFields(
  fields: Record<string, unknown>,
  photoField: string,
) {
  const mapped = readAirtableImages(fields[photoField]);
  if (mapped.length) return mapped;

  for (const value of Object.values(fields)) {
    if (!Array.isArray(value)) continue;
    const attachment = value.some(
      (item) =>
        Boolean(item) &&
        typeof item === "object" &&
        "url" in item &&
        "id" in item,
    );
    if (!attachment) continue;
    const images = readAirtableImages(value);
    if (images.length) return images;
  }

  return [];
}

export function isTemporaryAirtableImage(url: string) {
  try {
    return new URL(url).hostname.endsWith("airtableusercontent.com");
  } catch {
    return false;
  }
}
