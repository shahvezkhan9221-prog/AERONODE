import { cookies } from 'next/headers';
export async function isOperator() { return (await cookies()).get('sentinel_operator')?.value === 'demo-operator'; }
