export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, service: "voltship-public-api", version: "v1", time: new Date().toISOString() });
}
