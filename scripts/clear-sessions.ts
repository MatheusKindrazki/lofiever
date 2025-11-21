import 'dotenv/config';
import { redisHelpers } from '@/lib/redis';

async function clearSessions() {
  try {
    await redisHelpers.clearUserSessions();
    console.log('✅ Redis user sessions cleared successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to clear Redis sessions:', error);
    process.exit(1);
  }
}

void clearSessions();
