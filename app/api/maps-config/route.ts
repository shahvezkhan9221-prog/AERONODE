import { env } from "cloudflare:workers";

export function GET() {
  const apiKey = (env as unknown as { GOOGLE_MAPS_API_KEY?: string }).GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Response.json({ configured: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json({ configured: true, apiKey }, { headers: { "Cache-Control": "private, no-store" } });
}
