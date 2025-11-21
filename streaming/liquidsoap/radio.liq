#!/usr/bin/liquidsoap

# --- Configurações Gerais ---
set("log.file", "-")
set("log.level", 3)
set("server.telnet", false)

# --- Definição da Fonte Dinâmica ---
# Esta função é chamada pelo `request.dynamic` para obter a próxima faixa.
def get_next_track()
  # 1. Busca a URI da nossa API. A API deve retornar o caminho do arquivo como texto.
  uri = http.get("http://host.docker.internal:3000/api/next-track")
  log("Liquidsoap: Recebido do backend a URI: #{uri}")
  
  # 2. Cria uma "request" do Liquidsoap a partir da URI obtida.
  request.create(uri)
end

# Criamos a fonte dinâmica usando a função que acabamos de definir.
radio = request.dynamic(id="next_track_resolver", get_next_track)

# --- Fallbacks e Processamento ---
# Uma fonte de silêncio para usar como fallback.
silence = blank(duration=2.0)

# O fallback tentará tocar 'radio'. Se falhar, tocará o silêncio e tentará novamente.
source = fallback(track_sensitive=false, [radio, silence])

# mksafe garante que faixas individuais que falham não derrubem o stream.
source = mksafe(source)

# Normaliza o volume de todas as faixas.
source = normalize(source)

# --- Saída para o Icecast ---
# Envia a fonte processada para o servidor Icecast.
output.icecast(
  %opus(
    samplerate=48000,
    bitrate=128,
    channels=2
  ),
  id="icecast_output",
  host="icecast",
  port=8000,
  password="source_password",
  mount="/stream",
  name="Lofiever Radio",
  description="Lo-fi 24/7 Radio Stream",
  source
)
