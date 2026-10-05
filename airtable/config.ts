import "server-only";

export type AirtableProductFieldMap = {
  client: string;
  title: string;
  sku: string;
  photoUrl: string;
  createdDate: string;
  lifecycleStatus: string;
  sourcingStatus: string;
  sellingPrice: string;
  weightG: string;
  shippingChannel: string;
  productionLeadDays: string;
  moq: string;
  clientPrice: string;
  stockManual: string;
  requestJson: string;
  acceptedQuoteJson: string;
  quoteQuestionsJson: string;
  restockRequestsJson: string;
  researchJson: string;
  factoryPurchasePrice: string;
  supplierName: string;
  supplierContact: string;
  sourcingLocation: string;
  internalNotes: string;
  flaggedReason: string;
};

const defaultFields: AirtableProductFieldMap = {
  client: "Client",
  title: "Product Name",
  sku: "SKU",
  photoUrl: "Photo URL",
  createdDate: "Created Date",
  lifecycleStatus: "Lifecycle Status",
  sourcingStatus: "Sourcing Status",
  sellingPrice: "Selling Price",
  weightG: "Unit Weight (g)",
  shippingChannel: "Shipping Channel",
  productionLeadDays: "Production Lead Time (days)",
  moq: "MOQ",
  clientPrice: "Client Price",
  stockManual: "Stock",
  requestJson: "App Request JSON",
  acceptedQuoteJson: "Accepted Quote JSON",
  quoteQuestionsJson: "Quote Questions JSON",
  restockRequestsJson: "Restock Requests JSON",
  researchJson: "Research JSON",
  factoryPurchasePrice: "Factory Purchase Price",
  supplierName: "Supplier Name",
  supplierContact: "Supplier Contact",
  sourcingLocation: "Sourcing Location",
  internalNotes: "Internal Notes",
  flaggedReason: "Flagged Reason",
};

export function getAirtableConfig() {
  const token = process.env.AIRTABLE_API_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const productsTable = process.env.AIRTABLE_PRODUCTS_TABLE || "Products";
  let fields = defaultFields;
  if (process.env.AIRTABLE_PRODUCT_FIELDS_JSON) {
    try {
      fields = {
        ...defaultFields,
        ...(JSON.parse(process.env.AIRTABLE_PRODUCT_FIELDS_JSON) as Partial<AirtableProductFieldMap>),
      };
    } catch {
      throw new Error("AIRTABLE_PRODUCT_FIELDS_JSON must be valid JSON.");
    }
  }
  return {
    token,
    baseId,
    productsTable,
    fields,
    clientAsName: process.env.AIRTABLE_CLIENT_AS_NAME === "true",
    configured: Boolean(token && baseId),
  };
}
