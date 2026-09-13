import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!db) return Response.json({ ok: true, storage: false });
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, storage: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
