import { NextResponse } from 'next/server';

// This would come from your database or music source in a real app
const mockStreamData = {
  currentSong: {
    id: "song123",
    title: "Rainy Day Lofi",
    artist: "Lofi Artist",
    coverUrl: "https://images.unsplash.com/photo-1569982175971-d92b01cf8694?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    duration: 180, // in seconds
  },
  listeners: 128,
  daysActive: 7,
  songsPlayed: 342,
  nextUp: [
    {
      id: "song124",
      title: "Coffee Shop Vibes",
      artist: "Chill Beats",
      coverUrl: "https://images.unsplash.com/photo-1542320662-b15547e0c1fe?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
      duration: 165,
    },
    {
      id: "song125",
      title: "Late Night Study",
      artist: "Lo-fi Dreamer",
      coverUrl: "https://images.unsplash.com/photo-1534531173927-aeb928d54385?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
      duration: 195,
    }
  ]
};

export async function GET() {
  // Simulate latency
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    // In a real app, you would fetch this data from your database or service
    return NextResponse.json(mockStreamData, { status: 200 });
  } catch (error) {
    console.error("Error fetching stream data:", error);
    return NextResponse.json(
      { error: "Failed to fetch stream data" },
      { status: 500 }
    );
  }
} 