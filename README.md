# 🎵 Lofiever - Lo-fi 24/7 Radio Stream

Uma plataforma de streaming de música lo-fi 24/7 com sincronização em tempo real e playlists dinâmicas geradas por IA.

## 🚀 Quick Start

### 1. Subir toda a aplicação
```bash
npm run setup
```

Este comando irá:
- ✅ Subir todos os containers Docker (Icecast, Liquidsoap, PostgreSQL, Redis)
- ✅ Verificar se todos os serviços estão funcionando
- ✅ Mostrar o status do stream de áudio
- ✅ Exibir URLs e interfaces disponíveis

### 2. Iniciar o frontend e backend
```bash
# Terminal 1 - Frontend Next.js
npm run dev:next

# Terminal 2 - Servidor backend 
npm run dev:server
```

## 📊 Monitoramento

### Verificar status do stream
```bash
npm run stream:monitor
```

### Monitoramento contínuo (atualiza a cada 5s)
```bash
npm run stream:watch
```

### Status JSON do Icecast
```bash
npm run stream:test
```

## 🔧 Comandos Docker

```bash
# Subir containers
npm run docker:up

# Parar containers
npm run docker:down

# Ver logs em tempo real
npm run docker:logs

# Reiniciar containers
npm run docker:restart
```

## 🌐 Interfaces Disponíveis

- **Stream de Áudio**: http://localhost:8000/stream
- **Icecast Admin**: http://localhost:8000/admin/
  - Usuário: `admin`
  - Senha: `admin_password`
- **Frontend Next.js**: http://localhost:3000 (quando iniciado)
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

## 🏗️ Arquitetura

### Serviços Docker
- **Icecast**: Servidor de streaming de áudio
- **Liquidsoap**: Engine de processamento e geração de playlist
- **PostgreSQL**: Banco de dados principal
- **Redis**: Cache e sessões

### Stack da Aplicação
- **Frontend**: Next.js 15 com React 19
- **Backend**: Node.js com TypeScript
- **Streaming**: Icecast + Liquidsoap
- **Database**: PostgreSQL + Prisma ORM
- **Cache**: Redis + ioredis

## 📁 Estrutura do Projeto

```
lofiever/
├── src/                    # Código da aplicação Next.js
├── server/                 # Servidor backend Node.js
├── streaming/              # Configurações Icecast + Liquidsoap
├── scripts/                # Scripts de automação
├── public/music/           # Biblioteca de músicas
├── docker-compose.yml      # Orquestração dos serviços
└── package.json            # Scripts e dependências
```

## 🎯 Status da Implementação

Conforme o [TODO.md](./TODO.md), a **Fase 1** está completamente implementada:

- ✅ **1.1. Icecast configurado e rodando**
- ✅ **1.2. Liquidsoap integrado com Icecast**
- ✅ **1.3. Sincronização NTP implementada**
- ✅ **1.4. Protocolo DASH preparado**

### Próximas Fases
- 🔄 **Fase 2**: Playlist dinâmica com IA
- 🔄 **Fase 3**: Motor de recomendação IA
- 🔄 **Fase 4**: Integração frontend/backend
- 🔄 **Fase 5**: Deploy e monitoramento

## 🛠️ Desenvolvimento

### Instalar dependências
```bash
npm install
```

### Comandos de desenvolvimento
```bash
npm run dev          # Servidor backend
npm run dev:next     # Frontend Next.js
npm run dev:server   # Apenas backend
npm run build        # Build de produção
npm run lint         # Verificar código
```

### Testes
```bash
npm run test:redis   # Testar conexão Redis
```

## 🐳 Docker

### Configuração dos containers
O `docker-compose.yml` define:
- **Icecast**: Porta 8000, senhas configuradas
- **Liquidsoap**: Conecta ao Icecast, lê de `/music`
- **PostgreSQL**: Porta 5432, usuário `postgres`
- **Redis**: Porta 6379

### Volumes
- `./streaming/liquidsoap:/radio` - Scripts Liquidsoap
- `./public/music:/music` - Biblioteca de músicas
- `postgres-data` e `redis-data` - Persistência de dados

## 📝 Scripts Utilitários

### `scripts/start-app.sh`
Script principal que sobe tudo e verifica o status

### `scripts/monitor-stream.sh`
Monitora o status do stream e serviços em tempo real

## 🔐 Configurações de Segurança

### Icecast
- Source password: `source_password`
- Admin password: `admin_password`
- Relay password: `relay_password`

### Banco de Dados
- PostgreSQL: `postgres`/`postgres`
- Redis: Sem senha (desenvolvimento)

## 📋 Troubleshooting

### Stream não funciona
```bash
# Verificar containers
docker-compose ps

# Ver logs
npm run docker:logs

# Reiniciar tudo
npm run docker:restart
npm run setup
```

### Problemas de porta
Certifique-se que as portas estão livres:
- 8000 (Icecast)
- 5432 (PostgreSQL)  
- 6379 (Redis)
- 3000 (Next.js)

### Logs detalhados
```bash
# Logs específicos do Liquidsoap
docker-compose logs liquidsoap

# Logs específicos do Icecast  
docker-compose logs icecast
```

## 🎵 Testando o Stream

### Via browser
Abra http://localhost:8000/stream em um player de áudio

### Via VLC
```bash
vlc http://localhost:8000/stream
```

### Via curl
```bash
curl -I http://localhost:8000/stream
```

## 📚 Documentação Adicional

- [TODO.md](./TODO.md) - Roadmap de implementação
- [docs/relatorio-tecnico.md](./docs/relatorio-tecnico.md) - Relatório técnico detalhado
- [Liquidsoap Documentation](https://www.liquidsoap.info/)
- [Icecast Documentation](https://icecast.org/docs/)

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo LICENSE para mais detalhes.
