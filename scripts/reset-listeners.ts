import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function resetListeners() {
  const redis = new Redis(REDIS_URL);

  try {
    // Reset listeners count
    await redis.set('lofiever:listeners:count', '0');

    // Get current value to confirm
    const count = await redis.get('lofiever:listeners:count');
    console.log('✅ Listeners count reset to:', count);

    // Also clear any stale session data
    const sessionKeys = await redis.keys('lofiever:session:*');
    if (sessionKeys.length > 0) {
      await redis.del(...sessionKeys);
      console.log(`🧹 Cleared ${sessionKeys.length} stale sessions`);
    }

    // Clear user active status
    const activeKeys = await redis.keys('lofiever:user:*:active');
    if (activeKeys.length > 0) {
      await redis.del(...activeKeys);
      console.log(`🧹 Cleared ${activeKeys.length} active user markers`);
    }

  } catch (error) {
    console.error('❌ Error resetting listeners:', error);
  } finally {
    await redis.quit();
  }
}

resetListeners();
