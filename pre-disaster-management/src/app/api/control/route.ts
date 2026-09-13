import { isOperator } from '@/lib/auth';
import { monitor } from '@/lib/monitor';
import { NextResponse } from 'next/server';
export async function POST(request: Request) {
 if (!await isOperator()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 const data = await request.json().catch(() => ({}));
 if (!['simulation', 'hardware'].includes(data.source) || !['idle', 'earthquake', 'flood'].includes(data.scenario)) return NextResponse.json({ error: 'Invalid source or scenario' }, { status: 400 });
 monitor.setControl(data.source, data.scenario);
 return NextResponse.json(await monitor.snapshot());
}
