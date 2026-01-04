import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/auth/admin';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();

  if (!session) {
    // Redirect to sign in if not authenticated or not admin
    redirect('/api/auth/signin?callbackUrl=/admin');
  }

  return <>{children}</>;
}
