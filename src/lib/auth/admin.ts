import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { config } from '@/lib/config';

/**
 * Check if the current user is an admin based on their email
 * Admin emails are configured via ADMIN_EMAILS environment variable
 */
export async function isAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return false;
  }

  return config.admin.allowedEmails.includes(session.user.email);
}

/**
 * Require admin access - throws error if user is not an admin
 */
export async function requireAdmin(): Promise<void> {
  const admin = await isAdmin();

  if (!admin) {
    throw new Error('Unauthorized: Admin access required');
  }
}

/**
 * Get current admin session or null if not authenticated/not admin
 */
export async function getAdminSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return null;
  }

  if (!config.admin.allowedEmails.includes(session.user.email)) {
    return null;
  }

  return session;
}
