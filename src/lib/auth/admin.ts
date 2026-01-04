import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { config } from '@/lib/config';

/**
 * Check if email is in allowed admin list (case-insensitive)
 */
function isEmailAllowed(email: string): boolean {
  const normalizedEmail = email.toLowerCase();
  return config.admin.allowedEmails.some(
    allowed => allowed.toLowerCase() === normalizedEmail
  );
}

/**
 * Check if the current user is an admin based on their email
 * Admin emails are configured via ADMIN_EMAILS environment variable
 */
export async function isAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return false;
  }

  return isEmailAllowed(session.user.email);
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

  if (!isEmailAllowed(session.user.email)) {
    return null;
  }

  return session;
}
