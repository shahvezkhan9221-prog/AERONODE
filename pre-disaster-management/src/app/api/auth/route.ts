import { NextResponse } from 'next/server';
export async function POST(request: Request) {
 const data = await request.json().catch(() => ({}));
 if (!(data.demo === true || (data.email === 'operator@sentinel.mesh' && data.password === 'sentinel2026'))) return NextResponse.json({ error: 'Credentials do not match. Use the demo credentials below.' }, { status: 401 });
 const response = NextResponse.json({ ok: true });
 response.cookies.set('sentinel_operator', 'demo-operator', { httpOnly: true, sameSite: 'lax', secure: new URL(request.url).protocol === 'https:', path: '/', maxAge: 86400 });
 return response;
}
export async function DELETE() { const response = NextResponse.json({ ok: true }); response.cookies.delete('sentinel_operator'); return response; }
