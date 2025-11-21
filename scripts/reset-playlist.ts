import { Redis } from 'ioredis';
import { KEYS } from '../src/lib/redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function resetPlaylist() {
  const redis = new Redis(REDIS_URL);

  try {
    // Reset playlist position to start
    await redis.set('lofiever:playlist:position', '0');
    console.log('✅ Playlist position reset to 0');

    // Clear current track
    await redis.del(KEYS.CURRENT_TRACK);
    console.log('🧹 Cleared current track');

    // Clear playlist cache (correct key!)
    await redis.del(KEYS.PLAYLIST_CACHE);
    console.log('🧹 Cleared playlist cache');

    // Clear playback state
    await redis.del(KEYS.PLAYBACK_STATE);
    console.log('🧹 Cleared playback state');

    console.log('\n✅ Playlist reset complete!');
    console.log('Next call to /api/next-track will start from position 0');

  } catch (error) {
    console.error('❌ Error resetting playlist:', error);
  } finally {
    await redis.quit();
  }
}

resetPlaylist();
