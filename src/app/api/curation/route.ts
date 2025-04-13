import { NextResponse } from 'next/server';

// In a real app, this would connect to OpenAI's API
async function getAIRecommendations(prompt: string) {
  // This is a mock of what OpenAI might return
  console.log(`AI prompt received: ${prompt}`);
  
  // Mock data - in a real app, this would be the response from OpenAI
  return {
    recommendations: [
      {
        title: "Midnight Coffee",
        artist: "Sleepy Beats",
        mood: "calm",
        bpm: 75,
        duration: 180,
      },
      {
        title: "Urban Rain",
        artist: "City Lofi",
        mood: "melancholic",
        bpm: 80,
        duration: 195,
      },
      {
        title: "Study Break",
        artist: "Chill Academia",
        mood: "focused",
        bpm: 70,
        duration: 210,
      },
      {
        title: "Empty Streets",
        artist: "Night Walker",
        mood: "atmospheric",
        bpm: 65,
        duration: 225,
      },
      {
        title: "Morning Pages",
        artist: "Ambient Thoughts",
        mood: "inspired",
        bpm: 85,
        duration: 190,
      }
    ]
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prompt } = body;
    
    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }
    
    // In a real app, this would call OpenAI's API with the prompt
    const recommendations = await getAIRecommendations(prompt);
    
    return NextResponse.json(recommendations, { status: 200 });
  } catch (error) {
    console.error("Error getting AI recommendations:", error);
    return NextResponse.json(
      { error: "Failed to get AI recommendations" },
      { status: 500 }
    );
  }
} 