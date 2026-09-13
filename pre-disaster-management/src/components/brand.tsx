import { Radar } from 'lucide-react';
export default function Brand({ compact = false }: { compact?: boolean }) { return <div className={`brand ${compact ? 'compact' : ''}`}><div className="brand-mark"><Radar size={25} strokeWidth={1.5} /></div><div><strong>SENTINEL<span>-MESH</span></strong><small>ENVIRONMENTAL INTELLIGENCE</small></div></div>; }
