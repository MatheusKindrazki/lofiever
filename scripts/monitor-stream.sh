#!/bin/bash

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}🎵 Monitor do Lofiever Stream${NC}"
echo "================================"

# Função para obter status do stream
get_stream_status() {
    local status_json=$(curl -s http://localhost:8000/status-json.xsl 2>/dev/null)
    
    if [ $? -eq 0 ] && [ -n "$status_json" ]; then
        local listeners=$(echo "$status_json" | jq -r '.icestats.source.listeners // 0')
        local listener_peak=$(echo "$status_json" | jq -r '.icestats.source.listener_peak // 0')
        local server_name=$(echo "$status_json" | jq -r '.icestats.source.server_name // "N/A"')
        local stream_start=$(echo "$status_json" | jq -r '.icestats.source.stream_start // "N/A"')
        local genre=$(echo "$status_json" | jq -r '.icestats.source.genre // "N/A"')
        local server_type=$(echo "$status_json" | jq -r '.icestats.source.server_type // "N/A"')
        
        echo -e "${GREEN}✓ Stream Online${NC}"
        echo -e "${BLUE}Nome: ${NC}$server_name"
        echo -e "${BLUE}Gênero: ${NC}$genre"
        echo -e "${BLUE}Formato: ${NC}$server_type"
        echo -e "${BLUE}Ouvintes: ${NC}$listeners (Pico: $listener_peak)"
        echo -e "${BLUE}Início: ${NC}$stream_start"
        echo -e "${BLUE}URL: ${NC}http://localhost:8000/stream"
    else
        echo -e "${RED}✗ Stream Offline ou Inacessível${NC}"
    fi
}

# Função para verificar liquidsoap
check_liquidsoap() {
    if docker-compose ps liquidsoap | grep -q "Up"; then
        echo -e "${GREEN}✓ Liquidsoap rodando${NC}"
    else
        echo -e "${RED}✗ Liquidsoap com problemas${NC}"
    fi
}

# Função para verificar icecast
check_icecast() {
    if docker-compose ps icecast | grep -q "Up"; then
        echo -e "${GREEN}✓ Icecast rodando${NC}"
    else
        echo -e "${RED}✗ Icecast com problemas${NC}"
    fi
}

# Modo contínuo ou single check
if [ "$1" = "--watch" ] || [ "$1" = "-w" ]; then
    echo -e "${YELLOW}Modo de monitoramento contínuo (Ctrl+C para sair)${NC}"
    echo ""
    
    while true; do
        clear
        echo -e "${CYAN}🎵 Monitor do Lofiever Stream${NC}"
        echo "================================"
        echo "$(date '+%Y-%m-%d %H:%M:%S')"
        echo ""
        
        echo -e "${YELLOW}📊 Status dos Serviços:${NC}"
        check_icecast
        check_liquidsoap
        echo ""
        
        echo -e "${YELLOW}🎧 Status do Stream:${NC}"
        get_stream_status
        echo ""
        
        echo -e "${CYAN}Próxima atualização em 5 segundos...${NC}"
        sleep 5
    done
else
    echo ""
    echo -e "${YELLOW}📊 Status dos Serviços:${NC}"
    check_icecast
    check_liquidsoap
    echo ""
    
    echo -e "${YELLOW}🎧 Status do Stream:${NC}"
    get_stream_status
    echo ""
    
    echo -e "${CYAN}Para monitoramento contínuo: $0 --watch${NC}"
fi 