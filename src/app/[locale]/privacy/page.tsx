import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacidade | Lofiever',
  description: 'Política de privacidade do Lofiever e do aplicativo Lofiever para Apple TV.',
};

const copy = {
  pt: {
    eyebrow: 'TRANSPARÊNCIA',
    title: 'Política de privacidade',
    intro: 'Esta política se aplica ao site Lofiever e ao aplicativo Lofiever para Apple TV.',
    sections: [
      {
        title: 'O que o aplicativo não faz',
        body: 'O Lofiever TV não exige cadastro, não usa publicidade, não vende dados pessoais e não rastreia sua atividade entre aplicativos ou sites.',
      },
      {
        title: 'Dados técnicos necessários',
        body: 'Para entregar a rádio, o aplicativo se conecta à infraestrutura do Lofiever e ao provedor de conteúdo. Endereço IP, tipo de dispositivo, versão do sistema, horários e registros técnicos da solicitação podem ser processados temporariamente para transmissão, segurança, prevenção de abuso e diagnóstico de falhas.',
      },
      {
        title: 'Compartilhamento e finalidade',
        body: 'Esses dados técnicos podem ser processados por provedores de hospedagem, rede e distribuição de conteúdo somente para operar e proteger o serviço. Eles não são usados para publicidade direcionada nem vendidos a terceiros.',
      },
      {
        title: 'Seus controles',
        body: 'Você pode interromper esse processamento deixando de usar o aplicativo. Para dúvidas ou solicitações relacionadas à privacidade, use o canal indicado na página de suporte.',
      },
    ],
    support: 'Acessar suporte',
    updated: 'Atualizada em 19 de julho de 2026.',
  },
  en: {
    eyebrow: 'TRANSPARENCY',
    title: 'Privacy policy',
    intro: 'This policy applies to the Lofiever website and the Lofiever app for Apple TV.',
    sections: [
      {
        title: 'What the app does not do',
        body: 'Lofiever TV does not require an account, use advertising, sell personal data, or track your activity across apps or websites.',
      },
      {
        title: 'Required technical data',
        body: 'To deliver the radio stream, the app connects to Lofiever infrastructure and content providers. IP address, device type, operating system version, timestamps, and technical request logs may be processed temporarily for delivery, security, abuse prevention, and troubleshooting.',
      },
      {
        title: 'Sharing and purpose',
        body: 'This technical data may be processed by hosting, network, and content delivery providers only to operate and protect the service. It is not used for targeted advertising or sold to third parties.',
      },
      {
        title: 'Your controls',
        body: 'You can stop this processing by discontinuing use of the app. For privacy questions or requests, use the channel listed on the support page.',
      },
    ],
    support: 'Open support',
    updated: 'Updated July 19, 2026.',
  },
};

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const language = locale === 'en' ? 'en' : 'pt';
  const text = copy[language];

  return (
    <main className="min-h-screen bg-[#f2e7ce] px-6 py-12 text-[#1c1813] sm:px-10 lg:px-20">
      <article className="mx-auto max-w-4xl border-4 border-[#1c1813] bg-[#eadcbd] p-7 shadow-[12px_12px_0_#e8430f] sm:p-12">
        <p className="text-sm font-black tracking-[0.22em] text-[#e8430f]">{text.eyebrow}</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">{text.title}</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-[#625a4c]">{text.intro}</p>
        <div className="my-8 h-1 bg-[#1c1813]" />
        <div className="space-y-8">
          {text.sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-2xl font-black">{section.title}</h2>
              <p className="mt-3 text-base leading-7 text-[#625a4c]">{section.body}</p>
            </section>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t-2 border-[#1c1813] pt-6">
          <a className="font-black underline decoration-2 underline-offset-4" href={`/${language}/support`}>
            {text.support}
          </a>
          <p className="text-sm font-bold text-[#625a4c]">{text.updated}</p>
        </div>
      </article>
    </main>
  );
}
