// src/app/api/auth/[...nextauth]/route.ts
import NextAuth, { type NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import { config } from '@/lib/config';

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: config.auth.providers.github.clientId || '',
      clientSecret: config.auth.providers.github.clientSecret || '',
    }),
  ],
  secret: config.auth.secret,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
