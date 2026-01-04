import { NextResponse } from 'next/server';
import { ModerationService } from '@/services/moderation/moderation.service';
import { ProactiveEngagementService } from '@/services/moderation/proactive-engagement.service';
import { handleApiError } from '@/lib/api-utils';
import { requireAdmin } from '@/lib/auth/admin';

export async function GET() {
  try {
    // Require admin authentication
    await requireAdmin();

    const [moderationStats, engagementStats] = await Promise.all([
      ModerationService.getModerationStats(),
      ProactiveEngagementService.getEngagementStats(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        moderation: moderationStats,
        engagement: engagementStats,
      },
    });
  } catch (error) {
    // Check if it's an authorization error
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Admin access required' },
        { status: 401 }
      );
    }
    return handleApiError(error);
  }
}
