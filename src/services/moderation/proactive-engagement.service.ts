import { prisma } from '@/lib/prisma';
import { redisHelpers } from '@/lib/redis';
import type { Track } from '@prisma/client';

export interface EngagementMessage {
  type: 'track_announcement' | 'engagement' | 'mood_comment' | 'question' | 'tip';
  content: string;
  metadata?: Record<string, unknown>;
}

// Engagement message templates
const ENGAGEMENT_QUESTIONS = [
  "O que vocês estão fazendo agora? Estudando, trabalhando ou só relaxando?",
  "Qual o mood de vocês hoje? Posso ajustar a vibe!",
  "Alguém tem uma sugestão especial para a próxima música?",
  "Como está a energia por aí? Querem algo mais animado ou mais calmo?",
  "Essa música combina com o momento de vocês?",
  "Quem aí está curtindo essa playlist?",
  "Qual tipo de lo-fi vocês preferem? Jazz, chill, ou algo mais experimental?",
  "Estão gostando da seleção? Me contem!",
];

const MOOD_COMMENTS: Record<string, string[]> = {
  calm: [
    "Essa é perfeita pra acalmar a mente...",
    "Deixa a paz fluir com essa...",
    "Som pra meditar e refletir.",
  ],
  melancholic: [
    "Pra aqueles momentos mais introspectivos...",
    "Uma melodia que fala com a alma.",
    "Às vezes a melancolia traz as melhores inspirações.",
  ],
  focused: [
    "Hora de focar! Essa vai ajudar.",
    "Concentração total com essa track.",
    "Perfeita pra produtividade!",
  ],
  relaxed: [
    "Só relaxa e deixa a música te levar...",
    "Vibe tranquila pra descansar.",
    "Som pra desacelerar.",
  ],
  nostalgic: [
    "Essa traz aquela nostalgia boa...",
    "Lembra de algo especial?",
    "Memórias boas com essa melodia.",
  ],
  happy: [
    "Energia positiva chegando!",
    "Essa é pra alegrar o dia!",
    "Boas vibes com essa track.",
  ],
  energetic: [
    "Bora aumentar a energia!",
    "Essa dá aquele gás extra.",
    "Pra quem precisa de motivação!",
  ],
  cozy: [
    "Aconchego em forma de música...",
    "Perfeita pra um momento quentinho.",
    "Som de cobertor e café.",
  ],
};

const TIPS = [
  "Dica: Vocês podem pedir músicas específicas ou só descrever o mood que querem!",
  "Lembrete: Cada pessoa pode fazer até 5 pedidos por hora.",
  "Curiosidade: Todas as músicas aqui são selecionadas pra manter uma vibe lo-fi consistente.",
  "Dica: Se não achar a música exata, descreva o estilo que você quer!",
];

export const ProactiveEngagementService = {
  /**
   * Generate a track announcement message
   */
  generateTrackAnnouncement(track: Track): EngagementMessage {
    const moodComments = track.mood ? MOOD_COMMENTS[track.mood.toLowerCase()] : null;
    let comment = '';

    if (moodComments && moodComments.length > 0) {
      comment = moodComments[Math.floor(Math.random() * moodComments.length)];
    }

    const bpmInfo = track.bpm ? ` | ${track.bpm} BPM` : '';
    const durationMinutes = Math.floor(track.duration / 60);
    const durationSeconds = track.duration % 60;
    const durationStr = `${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}`;

    const content = comment
      ? `Agora tocando: "${track.title}" por ${track.artist}. ${comment} (${durationStr}${bpmInfo})`
      : `Tocando agora: "${track.title}" de ${track.artist}. Aproveitem! (${durationStr}${bpmInfo})`;

    return {
      type: 'track_announcement',
      content,
      metadata: {
        trackId: track.id,
        trackTitle: track.title,
        trackArtist: track.artist,
        mood: track.mood,
        bpm: track.bpm,
      },
    };
  },

  /**
   * Generate a random engagement question
   */
  generateEngagementQuestion(): EngagementMessage {
    const question = ENGAGEMENT_QUESTIONS[
      Math.floor(Math.random() * ENGAGEMENT_QUESTIONS.length)
    ];

    return {
      type: 'question',
      content: question,
    };
  },

  /**
   * Generate a mood comment based on current playlist vibe
   */
  async generateMoodComment(): Promise<EngagementMessage | null> {
    const currentTrack = await redisHelpers.getCurrentTrack();

    if (!currentTrack || !currentTrack.mood) {
      return null;
    }

    const moodComments = MOOD_COMMENTS[currentTrack.mood.toLowerCase()];
    if (!moodComments || moodComments.length === 0) {
      return null;
    }

    return {
      type: 'mood_comment',
      content: moodComments[Math.floor(Math.random() * moodComments.length)],
      metadata: { mood: currentTrack.mood },
    };
  },

  /**
   * Generate a random tip
   */
  generateTip(): EngagementMessage {
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];

    return {
      type: 'tip',
      content: tip,
    };
  },

  /**
   * Get the next proactive message based on context
   */
  async getNextProactiveMessage(): Promise<EngagementMessage> {
    // Get recent proactive messages to avoid repetition
    const recentMessages = await prisma.proactiveMessage.findMany({
      take: 5,
      orderBy: { sentAt: 'desc' },
    });

    const recentTypes = recentMessages.map((m) => m.type);

    // Weighted random selection based on what hasn't been sent recently
    const weights = {
      question: recentTypes.includes('question') ? 1 : 3,
      mood_comment: recentTypes.includes('mood_comment') ? 1 : 2,
      tip: recentTypes.includes('tip') ? 1 : 2,
    };

    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;

    for (const [type, weight] of Object.entries(weights)) {
      random -= weight;
      if (random <= 0) {
        switch (type) {
          case 'question':
            return this.generateEngagementQuestion();
          case 'mood_comment':
            const moodMsg = await this.generateMoodComment();
            if (moodMsg) return moodMsg;
            return this.generateEngagementQuestion();
          case 'tip':
            return this.generateTip();
        }
      }
    }

    return this.generateEngagementQuestion();
  },

  /**
   * Save a proactive message to history
   */
  async saveProactiveMessage(message: EngagementMessage): Promise<void> {
    await prisma.proactiveMessage.create({
      data: {
        type: message.type,
        content: message.content,
        metadata: (message.metadata || {}) as object,
      },
    });
  },

  /**
   * Check if it's time to send a proactive message
   * Returns true if enough time has passed since last engagement
   */
  async shouldSendProactiveMessage(minIntervalMinutes: number = 5): Promise<boolean> {
    const lastMessage = await prisma.proactiveMessage.findFirst({
      where: {
        type: { in: ['question', 'tip', 'mood_comment'] },
      },
      orderBy: { sentAt: 'desc' },
    });

    if (!lastMessage) return true;

    const timeSinceLastMessage = Date.now() - lastMessage.sentAt.getTime();
    return timeSinceLastMessage >= minIntervalMinutes * 60 * 1000;
  },

  /**
   * Get engagement stats for admin dashboard
   */
  async getEngagementStats() {
    const [totalMessages, messagesByType, recentMessages] = await Promise.all([
      prisma.proactiveMessage.count(),
      prisma.proactiveMessage.groupBy({
        by: ['type'],
        _count: true,
      }),
      prisma.proactiveMessage.findMany({
        take: 10,
        orderBy: { sentAt: 'desc' },
      }),
    ]);

    return {
      totalMessages,
      messagesByType: messagesByType.reduce(
        (acc, item) => ({ ...acc, [item.type]: item._count }),
        {} as Record<string, number>
      ),
      recentMessages,
    };
  },
};
