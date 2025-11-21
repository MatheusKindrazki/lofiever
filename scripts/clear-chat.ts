import 'dotenv/config';
import { redisHelpers } from '@/lib/redis';

async function clearChat() {
  try {
    await redisHelpers.clearChatHistory();
    console.log('✅ Chat history cleared successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to clear chat history:', error);
    process.exit(1);
  }
}

void clearChat();
