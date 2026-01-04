#!/usr/bin/liquidsoap

# --- Configurações Gerais ---
set("log.file", "-")
set("log.level", 3)
set("server.telnet", false)

# --- Environment Configuration ---
# Liquidsoap 2.x requires named 'default' parameter
api_host = environment.get(default="app", "API_HOST")
api_port = environment.get(default="3000", "API_PORT")
api_base = "http://#{api_host}:#{api_port}"

icecast_host = environment.get(default="icecast", "ICECAST_HOST")
icecast_port = int_of_string(environment.get(default="8000", "ICECAST_PORT"))
icecast_password = environment.get(default="hackme", "ICECAST_SOURCE_PASSWORD")

log("Liquidsoap: Using API at #{api_base}")
log("Liquidsoap: Using Icecast at #{icecast_host}:#{icecast_port}")

# --- Variables to store track metadata ---
trackId = ref("")
trackTitle = ref("")
trackArtist = ref("")

# --- Definição da Fonte Dinâmica ---
# Esta função é chamada pelo `request.dynamic` para obter a próxima faixa.
def get_next_track()
  # 1. Busca a URI da nossa API
  uri = http.get("#{api_base}/api/next-track")
  
  log("Liquidsoap: Recebido do backend a URI (length=#{string.length(uri)}): #{uri}")
  
  # 2. Se a URI estiver vazia, registrar erro
  if string.length(uri) == 0 then
    log("Liquidsoap: ERRO - URI vazia recebida do backend!")
  end
  
  # 3. Cria uma "request" do Liquidsoap a partir da URI obtida.
  req = request.create(uri)
  
  # 4. Try to extract metadata from the request URI or use a secondary API call
  # For now, we'll make a simpler implementation that extracts from the filename
  # The track ID, title and artist will be sent via the /api/track-started callback
  # based on what we get from Redis when the track actually starts
  
  req
end

# Criamos a fonte dinâmica usando a função que acabamos de definir.
radio = request.dynamic(id="next_track_resolver", get_next_track)

# --- Callback when track starts playing ---
# This will be called when a new track begins
def on_track_start(m)
  log("Liquidsoap: Track started - Metadata: #{m}")
  
  # Extract URI from metadata
  uri = m["initial_uri"]
  
  log("Liquidsoap: Processing URI: #{uri}")
  
  track_id = ref("")
  
  if uri != "" then
    # Try to extract UUID from URI
    # URI format: .../music/UUID-Title.mp3
    # We split by "music/" and take the first 36 chars of the second part
    parts = string.split(separator="music/", uri)
    
    log("Liquidsoap: Split parts count: #{list.length(parts)}")
    
    if list.length(parts) > 1 then
      # The part after music/
      suffix = list.nth(parts, 1)
      log("Liquidsoap: Suffix found: #{suffix}")
      
      # UUID is 36 chars
      if string.length(suffix) >= 36 then
        id = string.sub(suffix, start=0, length=36)
        track_id := id
        log("Liquidsoap: Extracted Track ID: #{track_id()}")
      else
        log("Liquidsoap: Suffix too short for UUID: #{suffix}")
      end
    else
      log("Liquidsoap: 'music/' not found in URI: #{uri}")
    end
  else
    log("Liquidsoap: No initial_uri in metadata")
  end

  log("Liquidsoap: Track started - Notifying backend with ID: #{track_id()}")
  
  # Call the backend to update currentTrack
  try
    # Construct JSON manually to avoid interpolation issues
    json_payload = '{"trackId": "' ^ track_id() ^ '"}'
    log("Liquidsoap: Sending payload: #{json_payload}")
    
    response = http.post(
      headers=[("Content-Type", "application/json")],
      data=json_payload,
      "#{api_base}/api/track-started"
    )
    log("Liquidsoap: Backend notified. Response: #{response}")
  catch err do
    log("Liquidsoap: ERROR notifying backend: #{err}")
  end
end

# Attach callback to the source
radio = source.on_track(radio, on_track_start)

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
  host=icecast_host,
  port=icecast_port,
  password=icecast_password,
  mount="/stream",
  name="Lofiever Radio",
  description="Lo-fi 24/7 Radio Stream",
  source
)
