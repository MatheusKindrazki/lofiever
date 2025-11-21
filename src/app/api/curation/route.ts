import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { handleApiError } from '@/lib/api-utils';
import { defaultCurationPrompt } from '@/lib/prompts';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const RecommendationSchema = z.object({
  recommendations: z
    .array(
      z.object({
        title: z.string().min(2),
        artist: z.string().min(2),
        mood: z.string().min(2),
        bpm: z.number().int().min(60).max(95),
        duration: z.number().int().min(90).max(600),
        description: z
          .string()
          .min(10)
          .max(160)
          .describe('Breve explicação do porquê a faixa combina com o pedido.'),
      })
    )
    .min(3)
    .max(12),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

    if (!userPrompt && !defaultCurationPrompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    const composedPrompt = userPrompt
      ? `${defaultCurationPrompt}\n\nPedido do ouvinte: ${userPrompt}`
      : defaultCurationPrompt;

    const { object } = await generateObject({
      model: openai('gpt-4o-mini'),
      system:
        'Você é Lofine, a curadora oficial de lofi da rádio Lofiever. Gere apenas JSON válido seguindo o schema. '
        + 'Priorize títulos originais, mantenha o BPM tranquilo (entre 60 e 95) e descreva brevemente o clima de cada faixa. '
        + 'Responda sempre em português brasileiro.',
      prompt: composedPrompt,
      schema: RecommendationSchema,
    });

    return NextResponse.json(object, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
