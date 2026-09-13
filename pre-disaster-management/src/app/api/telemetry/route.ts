import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { isOperator } from "@/lib/auth";
import { db } from "@/db";
import { telemetrySamples } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isOperator()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!db)
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  const { searchParams } = new URL(request.url);
  const nodeId = searchParams.get("nodeId");
  if (nodeId && !["node-1", "node-2"].includes(nodeId))
    return NextResponse.json({ error: "Invalid nodeId" }, { status: 400 });
  const minutes = Math.min(
    1440,
    Math.max(1, Number(searchParams.get("minutes") ?? 60)),
  );
  const since = new Date(Date.now() - minutes * 60_000);
  const where = nodeId
    ? and(
        gte(telemetrySamples.timestamp, since),
        eq(telemetrySamples.nodeId, nodeId),
      )
    : gte(telemetrySamples.timestamp, since);
  const rows = await db
    .select()
    .from(telemetrySamples)
    .where(where)
    .orderBy(desc(telemetrySamples.timestamp))
    .limit(5000);
  return NextResponse.json(
    rows.map((row) => ({
      ...row,
      timestamp: row.timestamp.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
    })),
  );
}
