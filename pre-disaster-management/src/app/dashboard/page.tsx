import { redirect } from 'next/navigation';
import { isOperator } from '@/lib/auth';
import Dashboard from '@/components/dashboard';
export default async function Page() { if (!await isOperator()) redirect('/'); return <Dashboard />; }
