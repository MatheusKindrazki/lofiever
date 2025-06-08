#!/bin/bash

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎵 Iniciando Lofiever - Lo-fi 24/7 Radio Stream${NC}"
echo "=================================================="

# Função para verificar se um serviço está rodando
check_service() {
    local service=$1
    local port=$2
    local name=$3
    
    if curl -s "http://localhost:$port" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ $name está rodando em localhost:$port${NC}"
        return 0
    else
        echo -e "${RED}✗ $name não está respondendo em localhost:$port${NC}"
        return 1
    fi
}

# Subir containers Docker
echo -e "\n${YELLOW}📦 Iniciando containers Docker...${NC}"
docker-compose up -d

# Aguardar containers iniciarem
echo -e "${YELLOW}⏳ Aguardando containers iniciarem...${NC}"
sleep 10

# Verificar serviços
echo -e "\n${YELLOW}🔍 Verificando serviços...${NC}"
check_service "admin" "8000" "Icecast Server"

# Verificar status do stream
echo -e "\n${YELLOW}🎵 Verificando status do stream...${NC}"
STREAM_STATUS=$(curl -s http://localhost:8000/status-json.xsl | jq -r '.icestats.source.listeners // "N/A"')
if [ "$STREAM_STATUS" != "N/A" ]; then
    echo -e "${GREEN}✓ Stream ativo com $STREAM_STATUS ouvintes${NC}"
    STREAM_URL=$(curl -s http://localhost:8000/status-json.xsl | jq -r '.icestats.source.listenurl // "N/A"')
    echo -e "${BLUE}🎧 URL do Stream: $STREAM_URL${NC}"
else
    echo -e "${RED}✗ Stream não está ativo${NC}"
fi

# Verificar banco de dados
if docker-compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PostgreSQL está rodando${NC}"
else
    echo -e "${RED}✗ PostgreSQL não está respondendo${NC}"
fi

# Verificar Redis
if docker-compose exec -T redis redis-cli ping | grep -q "PONG"; then
    echo -e "${GREEN}✓ Redis está rodando${NC}"
else
    echo -e "${RED}✗ Redis não está respondendo${NC}"
fi

echo -e "\n${BLUE}🚀 Para iniciar a aplicação Next.js:${NC}"
echo "   npm run dev:next"
echo -e "\n${BLUE}🖥️  Para iniciar o servidor backend:${NC}"
echo "   npm run dev:server"
echo -e "\n${BLUE}📊 Para ver logs em tempo real:${NC}"
echo "   docker-compose logs -f"
echo -e "\n${BLUE}🛑 Para parar todos os serviços:${NC}"
echo "   docker-compose down"

echo -e "\n${BLUE}📱 Interfaces disponíveis:${NC}"
echo "   • Icecast Admin: http://localhost:8000/admin/"
echo "   • Stream URL: http://localhost:8000/stream"
echo "   • Next.js App: http://localhost:3000 (quando iniciado)"

echo -e "\n${GREEN}✨ Setup completo!${NC}" 