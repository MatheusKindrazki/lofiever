import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Suporte | Lofiever',
  description: 'Suporte para o Lofiever e o aplicativo Lofiever para Apple TV.',
};

export default async function SupportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const english = locale === 'en';

  return (
    <main className="min-h-screen bg-[#f2e7ce] px-6 py-12 text-[#1c1813] sm:px-10 lg:px-20">
      <article className="mx-auto max-w-4xl border-4 border-[#1c1813] bg-[#eadcbd] p-7 shadow-[12px_12px_0_#f4b41a] sm:p-12">
        <p className="text-sm font-black tracking-[0.22em] text-[#e8430f]">
          {english ? 'HELP DESK' : 'CENTRAL DE AJUDA'}
        </p>
        <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">
          {english ? 'Lofiever support' : 'Suporte Lofiever'}
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-[#625a4c]">
          {english
            ? 'For playback issues, feedback, or feature requests, open a support ticket in the official Lofiever repository.'
            : 'Para problemas de reprodução, feedback ou sugestões, abra um chamado no repositório oficial do Lofiever.'}
        </p>
        <div className="my-8 h-1 bg-[#1c1813]" />
        <section>
          <h2 className="text-2xl font-black">{english ? 'Before opening a ticket' : 'Antes de abrir um chamado'}</h2>
          <ul className="mt-4 list-disc space-y-3 pl-6 text-base leading-7 text-[#625a4c]">
            <li>{english ? 'Confirm that the Apple TV is connected to the internet.' : 'Confirme que a Apple TV está conectada à internet.'}</li>
            <li>{english ? 'Note the track title and the approximate time of the issue.' : 'Anote o nome da faixa e o horário aproximado do problema.'}</li>
            <li>{english ? 'Include the tvOS version when reporting a playback failure.' : 'Inclua a versão do tvOS ao relatar falha de reprodução.'}</li>
          </ul>
        </section>
        <a
          className="mt-9 inline-block border-4 border-[#1c1813] bg-[#e8430f] px-6 py-4 text-base font-black text-white shadow-[6px_6px_0_#1c1813] transition-transform hover:-translate-y-1 focus-visible:outline focus-visible:outline-4"
          href="https://github.com/MatheusKindrazki/lofiever/issues/new"
          rel="noreferrer"
          target="_blank"
        >
          {english ? 'OPEN SUPPORT TICKET' : 'ABRIR CHAMADO'}
        </a>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t-2 border-[#1c1813] pt-6">
          <a className="font-black underline decoration-2 underline-offset-4" href={`/${english ? 'en' : 'pt'}/privacy`}>
            {english ? 'Privacy policy' : 'Política de privacidade'}
          </a>
          <a className="text-sm font-bold text-[#625a4c] underline" href="https://github.com/MatheusKindrazki/lofiever">
            github.com/MatheusKindrazki/lofiever
          </a>
        </div>
      </article>
    </main>
  );
}
