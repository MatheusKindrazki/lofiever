import { NextResponse } from 'next/server';

// WebSockets in Next.js App Router need to be handled differently
// This route will respond with a 404 because WebSockets are handled through a special middleware
export async function GET(): Promise<NextResponse> {
  return new NextResponse('WebSocket server is running, but connections should be made directly to this endpoint.', { status: 200 });
} 