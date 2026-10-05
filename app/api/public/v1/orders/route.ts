import { apiError, apiJson, authenticatePublicRequest } from "@/lib/public-api/auth";
import { resolvePublicOrder } from "@/lib/public-api/orders-server";

export const dynamic = "force-dynamic";

/** GET /api/public/v1/orders?order=1234[&email=…] — same payload as /orders/{lookup}. */
export async function GET(request: Request) {
  const auth = await authenticatePublicRequest(request);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const order = params.get("order") ?? params.get("number") ?? "";
  if (!order.trim()) return apiError(400, "Query parameter `order` is required.");
  try {
    const result = await resolvePublicOrder({ clientId: auth.clientId, lookup: order, email: params.get("email") });
    if (result.status === 404) return apiError(404, "Order not found.");
    return apiJson(result.body);
  } catch (error) {
    return apiError(500, error instanceof Error ? error.message : "Lookup failed.");
  }
}
