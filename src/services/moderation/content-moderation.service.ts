import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const ContentModerationService = {
    /**
     * Validate if a message content is safe to be broadcasted.
     * Uses a lightweight AI check to detect offensive content.
     */
    async validateMessage(content: string): Promise<{ safe: boolean; reason?: string }> {
        try {
            // Use a fast model for moderation
            const { text } = await generateText({
                model: openai('gpt-4o-mini'),
                system: `
          You are a content moderation system for a friendly Lo-Fi radio chat.
          Your job is to detect:
          1. Hate speech, racism, homophobia, sexism.
          2. Direct severe insults or harassment.
          3. Explicit sexual content.
          4. Spam or malicious links.
          
          Context: "Lofiever" is a chill radio station.
          
          Output JSON only: { "safe": boolean, "reason": string | null }
          If unsafe, provide a very brief reason in Portuguese (e.g., "Conteúdo ofensivo", "Discurso de ódio").
        `,
                prompt: `Message to validate: "${content}"`,
            });

            const result = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
            return {
                safe: result.safe,
                reason: result.reason || undefined,
            };
        } catch (error) {
            console.error('Moderation check failed:', error);
            // Fail open (allow message) if moderation service is down, or closed (block)?
            // For safety, let's allow but log error, or maybe block if critical.
            // Let's allow for now to avoid disrupting chat if API fails, unless it's a specific error.
            return { safe: true };
        }
    },
};
