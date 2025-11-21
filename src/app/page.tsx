/* eslint-disable @typescript-eslint/explicit-function-return-type */
import RadioPlayer from '@/components/RadioPlayer';
import ChatRoom from '@/components/ChatRoom';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-4 md:p-6 lg:p-8">
      <div className="z-10 w-full max-w-7xl flex flex-col items-center justify-start">
        <header className="flex flex-col items-center mb-6">
          <h1 className="text-4xl font-bold text-lofi-600 dark:text-lofi-300 md:text-6xl">
            Lofiever
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mt-2 text-center">
            24/7 Lofi streaming com DJ virtual
          </p>
        </header>

        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Coluna da esquerda - Player integrado */}
          <div className="lg:col-span-4 h-[500px] lg:h-[600px]">
            <RadioPlayer />
          </div>

          {/* Coluna da direita - Chat */}
          <div className="lg:col-span-8 h-[500px] lg:h-[600px]">
            <ChatRoom />
          </div>
        </div>

        <footer className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>© {new Date().getFullYear()} Lofiever. All rights reserved.</p>
          <p className="mt-1">Built with ❤️ using Next.js, React, and AI</p>
        </footer>
      </div>
    </main>
  );
} 
