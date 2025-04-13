import Player from '@/components/Player';
import Stats from '@/components/Stats';
import Curation from '@/components/Curation';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-4 md:p-8 lg:p-12">
      <div className="z-10 w-full max-w-5xl flex flex-col items-center justify-center gap-8">
        <header className="flex flex-col items-center">
          <h1 className="text-4xl font-bold text-lofi-600 dark:text-lofi-300 md:text-6xl">
            Lofiever
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mt-2 text-center">
            24/7 Lofi streaming with AI curation
          </p>
        </header>

        <Player />
        
        <Stats />
        
        <Curation />
        
        <footer className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>© {new Date().getFullYear()} Lofiever. All rights reserved.</p>
          <p className="mt-1">Built with ❤️ using Next.js, React, and AI</p>
        </footer>
      </div>
    </main>
  );
} 