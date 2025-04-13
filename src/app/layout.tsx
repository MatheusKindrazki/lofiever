import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Lofiever - 24/7 Lofi Streaming',
  description: 'Continuous streaming of lofi music with AI curation',
  keywords: ['lofi', 'music', 'streaming', 'AI', 'curation', 'study', 'focus', 'relax'],
  authors: [{ name: 'Lofiever Team' }],
  themeColor: '#8459c0',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
} 