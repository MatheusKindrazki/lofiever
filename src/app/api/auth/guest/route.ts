import { NextResponse } from 'next/server';
import { generateGuestToken } from '@/lib/auth/tokens';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

export async function POST(req: Request) {
    try {
        // Optional: Allow client to suggest a username, but sanitize it
        const body = await req.json().catch(() => ({}));
        const requestedUsername = body.username;

        const userId = `guest_${nanoid()}`;
        const username = requestedUsername || `Guest ${userId.substring(6)}`;

        const token = await generateGuestToken(userId, username);

        return NextResponse.json({
            token,
            user: {
                id: userId,
                name: username,
                isGuest: true,
            },
        });
    } catch (error) {
        console.error('Error generating guest token:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
