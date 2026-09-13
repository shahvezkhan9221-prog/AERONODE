import { isOperator } from '@/lib/auth';
import { monitor } from '@/lib/monitor';
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
 if (!await isOperator()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 try { return NextResponse.json(await monitor.history()); } catch { return NextResponse.json({ error: 'Event storage is temporarily unavailable. Live session events are still visible.' }, { status: 503 }); }
}
