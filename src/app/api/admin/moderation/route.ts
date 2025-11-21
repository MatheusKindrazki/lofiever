import { NextResponse } from 'next/server';
import { ModerationService } from '@/services/moderation/moderation.service';
import { ProactiveEngagementService } from '@/services/moderation/proactive-engagement.service';
import { handleApiError } from '@/lib/api-utils';

export async function GET() {
  try {
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
    return handleApiError(error);
  }
}
