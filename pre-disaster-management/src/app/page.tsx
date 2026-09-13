import { redirect } from 'next/navigation';
import { isOperator } from '@/lib/auth';
import Login from '@/components/login';
export default async function Page() { if (await isOperator()) redirect('/dashboard'); return <Login />; }
