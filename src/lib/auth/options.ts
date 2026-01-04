// src/lib/auth/options.ts
import type { NextAuthOptions } from 'next-auth';
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
