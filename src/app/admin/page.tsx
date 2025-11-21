'use client';

import { useEffect, useState } from 'react';

interface TrackRequest {
  id: string;
  trackId: string | null;
  userId: string;
  username: string;
  query: string;
  status: string;
  reason: string | null;
  processedAt: string | null;
  createdAt: string;
  track?: {
    title: string;
    artist: string;
  } | null;
}

interface ModerationStats {
  totalRequests: number;
  pendingRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  recentRequests: TrackRequest[];
}

interface ProactiveMessage {
  id: string;
  type: string;
  content: string;
  sentAt: string;
}

interface EngagementStats {
  totalMessages: number;
  messagesByType: Record<string, number>;
  recentMessages: ProactiveMessage[];
}

interface DashboardData {
  moderation: ModerationStats;
  engagement: EngagementStats;
}

export default function AdminPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchDashboardData() {
    try {
      setError(null);
      const response = await fetch('/api/admin/moderation');
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError('Erro ao carregar dados do dashboard');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-gray-500">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-red-500">{error}</p>
          <button
            onClick={fetchDashboardData}
            className="mt-4 px-4 py-2 bg-lofi-500 text-white rounded-md"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Painel de Moderação - Lofine DJ
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Gerencie pedidos e veja estatísticas de engajamento
          </p>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Total de Pedidos"
            value={data?.moderation.totalRequests || 0}
            color="blue"
          />
          <StatCard
            title="Aprovados"
            value={data?.moderation.approvedRequests || 0}
            color="green"
          />
          <StatCard
            title="Rejeitados"
            value={data?.moderation.rejectedRequests || 0}
            color="red"
          />
          <StatCard
            title="Mensagens Proativas"
            value={data?.engagement.totalMessages || 0}
            color="purple"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Requests */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Pedidos Recentes
            </h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {data?.moderation.recentRequests.map((request) => (
                <RequestCard key={request.id} request={request} />
              ))}
              {(!data?.moderation.recentRequests || data.moderation.recentRequests.length === 0) && (
                <p className="text-gray-500 text-sm">Nenhum pedido ainda</p>
              )}
            </div>
          </section>

          {/* Recent Proactive Messages */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Mensagens Proativas Recentes
            </h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {data?.engagement.recentMessages.map((message) => (
                <MessageCard key={message.id} message={message} />
              ))}
              {(!data?.engagement.recentMessages || data.engagement.recentMessages.length === 0) && (
                <p className="text-gray-500 text-sm">Nenhuma mensagem ainda</p>
              )}
            </div>
          </section>
        </div>

        {/* Engagement by Type */}
        {data?.engagement.messagesByType && Object.keys(data.engagement.messagesByType).length > 0 && (
          <section className="mt-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Mensagens por Tipo
            </h2>
            <div className="flex flex-wrap gap-4">
              {Object.entries(data.engagement.messagesByType).map(([type, count]) => (
                <div
                  key={type}
                  className="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg"
                >
                  <span className="text-sm text-gray-500 dark:text-gray-400 capitalize">
                    {type.replace('_', ' ')}
                  </span>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {count}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  color,
}: {
  title: string;
  value: number;
  color: 'blue' | 'green' | 'red' | 'purple';
}) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
      <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
      <p className={`text-3xl font-bold mt-2 ${colorClasses[color]} px-3 py-1 rounded-lg inline-block`}>
        {value}
      </p>
    </div>
  );
}

function RequestCard({ request }: { request: TrackRequest }) {
  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    auto_approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    not_found: 'bg-gray-100 text-gray-800',
  };

  const statusLabels: Record<string, string> = {
    pending: 'Pendente',
    approved: 'Aprovado',
    auto_approved: 'Auto-aprovado',
    rejected: 'Rejeitado',
    not_found: 'Não encontrado',
  };

  return (
    <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-medium text-gray-900 dark:text-white">
            {request.query}
          </p>
          {request.track && (
            <p className="text-sm text-gray-500">
              → {request.track.title} - {request.track.artist}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            por {request.username} • {new Date(request.createdAt).toLocaleString('pt-BR')}
          </p>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded-full ${statusColors[request.status] || 'bg-gray-100'}`}
        >
          {statusLabels[request.status] || request.status}
        </span>
      </div>
      {request.reason && (
        <p className="text-xs text-gray-500 mt-2 italic">{request.reason}</p>
      )}
    </div>
  );
}

function MessageCard({ message }: { message: ProactiveMessage }) {
  const typeLabels: Record<string, string> = {
    track_announcement: 'Anúncio',
    engagement: 'Engajamento',
    mood_comment: 'Mood',
    question: 'Pergunta',
    tip: 'Dica',
  };

  const typeColors: Record<string, string> = {
    track_announcement: 'bg-blue-100 text-blue-800',
    engagement: 'bg-purple-100 text-purple-800',
    mood_comment: 'bg-pink-100 text-pink-800',
    question: 'bg-yellow-100 text-yellow-800',
    tip: 'bg-green-100 text-green-800',
  };

  return (
    <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
      <div className="flex items-start justify-between mb-2">
        <span
          className={`text-xs px-2 py-1 rounded-full ${typeColors[message.type] || 'bg-gray-100'}`}
        >
          {typeLabels[message.type] || message.type}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(message.sentAt).toLocaleString('pt-BR')}
        </span>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300">{message.content}</p>
    </div>
  );
}
