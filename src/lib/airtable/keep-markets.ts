/**
 * A product imported from a Shopify store is priced for that store's countries (Admin ›
 * Boutiques, e.g. "US" or "FR,BE,CH,LU"): the app owns them, the Airtable copy of the brief
 * (written at import, often "FR") never puts the old country back.
 */
export function keepAppMarkets(existingRequest: unknown, airtableRequest: unknown, migrated: boolean) {
  const fromAirtable =
    airtableRequest && typeof airtableRequest === "object" ? (airtableRequest as Record<string, unknown>) : {};
  const current =
    existingRequest && typeof existingRequest === "object" ? (existingRequest as Record<string, unknown>) : {};
  if (!migrated || typeof current.destination_markets !== "string" || !current.destination_markets.trim()) {
    return fromAirtable;
  }
  return { ...fromAirtable, destination_markets: current.destination_markets };
}
