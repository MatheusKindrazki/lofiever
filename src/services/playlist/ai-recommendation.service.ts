export interface AITrackResponse {
  url: string;
}

const AI_API_URL = process.env.AI_API_URL || 'http://localhost:5001/next';

export async function requestRecommendedTrack(current?: string): Promise<string> {
  try {
    const res = await fetch(AI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current }),
    });
    if (!res.ok) throw new Error(`AI service responded ${res.status}`);
    const data = (await res.json()) as AITrackResponse;
    if (!data.url) throw new Error('Invalid AI response');
    return data.url;
  } catch (err) {
    console.error('AI recommendation error:', err);
    throw err;
  }
}
