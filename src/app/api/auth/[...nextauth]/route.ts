// src/app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import { config } from '@/lib/config';

const handler = NextAuth({
  providers: [
    GitHubProvider({
      clientId: config.auth.providers.github.clientId || '',
      clientSecret: config.auth.providers.github.clientSecret || '',
    }),
  ],
  secret: config.auth.secret,
});

export { handler as GET, handler as POST };
