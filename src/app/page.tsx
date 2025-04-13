import Player from '@/components/Player';
import Stats from '@/components/Stats';
import Curation from '@/components/Curation';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-4 md:p-6 lg:p-8 overflow-hidden">
      <div className="z-10 w-full max-w-7xl flex flex-col items-center justify-start h-full">
        <header className="flex flex-col items-center mb-6">
          <h1 className="text-4xl font-bold text-lofi-600 dark:text-lofi-300 md:text-6xl">
            Lofiever
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mt-2 text-center">
            24/7 Lofi streaming with AI curation
          </p>
        </header>

        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 overflow-hidden">
          {/* Coluna da esquerda com o Player */}
          <div className="flex flex-col h-full overflow-hidden">
            <Player />
          </div>
          
          {/* Coluna da direita com Stats e Curation */}
          <div className="flex flex-col gap-6 h-full overflow-hidden">
            <Stats />
            <div className="flex-1 overflow-auto">
              <Curation />
            </div>
          </div>
        </div>
        
        <footer className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>© {new Date().getFullYear()} Lofiever. All rights reserved.</p>
          <p className="mt-1">Built with ❤️ using Next.js, React, and AI</p>
        </footer>
      </div>
    </main>
  );
} 