import { isOperator } from '@/lib/auth';
import { monitor } from '@/lib/monitor';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
 if (!await isOperator()) return new Response('Unauthorized', { status: 401 });
 const encoder = new TextEncoder();
 let timer: ReturnType<typeof setInterval> | undefined;
 let closed = false;
 const stream = new ReadableStream({
  start(controller) {
   const send = async () => { try { const snapshot = await monitor.snapshot(); if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`)); } catch { if (!closed) { closed = true; if (timer) clearInterval(timer); controller.close(); } } };
   void send(); timer = setInterval(send, 2000);
   request.signal.addEventListener('abort', () => { if (closed) return; closed = true; if (timer) clearInterval(timer); controller.close(); });
  },
  cancel() { closed = true; if (timer) clearInterval(timer); }
 });
 return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
