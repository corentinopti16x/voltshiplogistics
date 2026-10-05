import { apiError, apiJson, authenticatePublicRequest } from "@/lib/public-api/auth";
import { resolvePublicOrder } from "@/lib/public-api/orders-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/v1/orders/{#1234 | 1234 | VS-ACME-1234 | <shopify id> | <uuid>}[?email=…]
 * Authorization: Bearer vs_live_…  · 401 bad key · 404 unknown order · 429 rate limited.
 */
export async function GET(request: Request, context: { params: Promise<{ lookup: string }> }) {
  const auth = await authenticatePublicRequest(request);
  if (!auth.ok) return auth.response;
  const { lookup } = await context.params;
  const email = new URL(request.url).searchParams.get("email");
  try {
    const result = await resolvePublicOrder({ clientId: auth.clientId, lookup, email });
    if (result.status === 404) return apiError(404, "Order not found.");
    return apiJson(result.body);
  } catch (error) {
    return apiError(500, error instanceof Error ? error.message : "Lookup failed.");
  }
}
