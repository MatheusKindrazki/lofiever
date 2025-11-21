# Integração com Cloudflare R2 e Seed Dinâmico

Este documento detalha as mudanças implementadas para otimizar o processo de "seeding" do banco de dados e integrar o armazenamento de mídias (músicas e capas) com o Cloudflare R2, garantindo segurança através de URLs pré-assinadas.

## Funcionalidades Implementadas

*   **Seed Dinâmico:** O script de seed (`scripts/seed-database.ts`) agora escaneia automaticamente o diretório `public/music`, extrai metadados e artes de capa dos arquivos de áudio, e popula o banco de dados.
*   **Modos de Seed (`dev` e `prod`):** O script pode ser executado em diferentes modos para se adaptar ao ambiente.
*   **Integração com Cloudflare R2:** No modo de produção, o script faz upload de músicas e capas para um bucket R2.
*   **Serviço de Mídia Seguro:** As mídias armazenadas no R2 são acessadas de forma segura através de URLs pré-assinadas, garantindo que o acesso direto aos arquivos seja restrito fora do domínio da aplicação.

## Variáveis de Ambiente Essenciais (`.env`)

Para o funcionamento correto da aplicação, as seguintes variáveis de ambiente devem ser configuradas:

```dotenv
# Configurações de Autenticação (NextAuth)
# URL da sua aplicação para os callbacks do OAuth
NEXTAUTH_URL="http://localhost:3000"
# Um segredo forte para assinar os tokens. Gere um em https://generate-secret.vercel.app/32
NEXTAUTH_SECRET="SEU_SEGREDO_FORTE_AQUI"
# Credenciais do seu aplicativo OAuth do GitHub
GITHUB_CLIENT_ID="SEU_GITHUB_CLIENT_ID"
GITHUB_CLIENT_SECRET="SEU_GITHUB_CLIENT_SECRET"

# Configurações da I.A. (OpenAI)
OPENAI_API_KEY="sk-SUA_CHAVE_DA_OPENAI_AQUI"

# Configurações do Cloudflare R2 (para modo de produção do seed)
R2_ACCESS_KEY_ID="SEU_ACCESS_KEY_ID_DO_R2"
R2_SECRET_ACCESS_KEY="SEU_SECRET_ACCESS_KEY_DO_R2"
R2_ENDPOINT="https://SEU_ACCOUNT_ID.r2.cloudflarestorage.com"
R2_BUCKET_NAME="SEU_NOME_DO_BUCKET_R2"
R2_PUBLIC_URL="https://pub-SEU_BUCKET_ID.r2.dev"
```

*   `NEXTAUTH_SECRET`: Essencial para a segurança das sessões.
*   `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`: Necessário para o login com GitHub. Você pode criar um OAuth App nas configurações de desenvolvedor do seu perfil do GitHub.
*   `OPENAI_API_KEY`: Necessária para que a curadoria com I.A. funcione.
*   **Variáveis R2**: Necessárias para o script de seed em modo de produção.

## Uso do Script de Seed (`npm run db:seed`)

O script de seed (`scripts/seed-database.ts`) agora suporta um argumento `--mode` para definir seu comportamento:

*   **Modo de Desenvolvimento (`--mode=dev` ou sem o argumento):**
    *   **Limpa** todo o banco de dados (faixas, playlists, histórico, etc.).
    *   Escaneia o diretório `public/music`.
    *   Cria registros `Track` no banco de dados com `sourceType: 'local'`, apontando para o nome do arquivo local.
    *   **Não** faz upload para o R2.
    *   **Uso:** `npm run db:seed` ou `npm run db:seed -- --mode=dev`
*   **Modo de Produção (`--mode=prod`):**
    *   **NÃO limpa** o banco de dados.
    *   Escaneia o diretório `public/music`.
    *   Para cada arquivo:
        *   Extrai metadados (título, artista).
        *   **Verifica duplicidade:** Se uma faixa com o mesmo título e artista já existe no banco, ela é pulada.
        *   Se não for duplicata:
            *   Faz upload do arquivo de música para o R2. A `sourceId` no banco será a **chave** do objeto no R2.
            *   Extrai a arte da capa (se presente) e faz upload para o R2. A `artworkKey` no banco será a **chave** do objeto da capa no R2.
            *   Cria o registro `Track` no banco de dados com `sourceType: 's3'` e as chaves R2.
    *   **Uso:** `npm run db:seed -- --mode=prod`
    *   **Importante:** Este modo requer que as variáveis de ambiente do R2 estejam configuradas.

### Exemplo de Comandos

```bash
# Iniciar os serviços Docker (Postgres, Redis, Icecast, Liquidsoap)
npm run docker:up

# Aplicar migrações do banco de dados (se houver alterações no esquema)
npx prisma migrate dev

# Popular o banco de dados (Modo Desenvolvimento - apaga tudo e recria com arquivos locais)
npm run db:seed

# OU

# Popular o banco de dados (Modo Produção - apenas adiciona novas músicas ao R2)
# Certifique-se de que suas variáveis de ambiente R2 estejam configuradas!
npm run db:seed -- --mode=prod

# Iniciar o servidor Next.js
npm run dev
```

## Configuração do Cloudflare R2 (Pré-requisitos)

*   **Crie um Bucket R2:** No seu painel do Cloudflare, crie um bucket R2.
*   **Acesso Privado:** Recomenda-se que o bucket seja **privado**. A aplicação foi projetada para usar URLs pré-assinadas, o que funciona melhor com buckets privados.
*   **Tokens de API:** Gere um token de API para o R2 com permissões de "Object Read" e "Object Write" para o seu bucket. Use essas credenciais para `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY`.
*   **Endpoint R2:** Encontre o endpoint S3-compatível e o endpoint público do seu bucket R2 no painel do Cloudflare.

## Servindo Mídia de Forma Segura

*   **Áudio (Liquidsoap):**
    *   O `LiquidsoapIntegrationService` agora consulta o `sourceType` da faixa.
    *   Se for `'s3'`, ele gera uma URL pré-assinada de curta duração (padrão de 1 hora) para o arquivo de áudio no R2.
    *   O Liquidsoap usa esta URL pré-assinada para buscar e transmitir a música.
*   **Capa (Frontend):**
    *   O endpoint `/api/stream` (que alimenta o `Player.tsx`) agora verifica a `artworkKey` da faixa.
    *   Se uma `artworkKey` existir (indicando que a capa está no R2), ele gera uma URL pré-assinada para a imagem da capa, garantindo que ela seja exibida no frontend de forma segura.

## Considerações Finais

*   **Arquivos de Música:** Certifique-se de ter seus arquivos `.mp3`, `.flac`, etc., no diretório `public/music` para que o script de seed possa encontrá-los.
*   **Fallback da Capa:** Se uma faixa não tiver uma `artworkKey` ou se houver um erro ao gerar a URL pré-assinada da capa, a aplicação usará `/default-cover.jpg` como fallback. Crie este arquivo em `public/default-cover.jpg` se desejar um fallback personalizado.
*   **Performance:** A geração de URLs pré-assinadas acontece sob demanda. Para um volume muito alto de requisições ou se o cache de metadata do Next.js/React-Query não for suficiente, pode-se considerar implementar um cache de URLs pré-assinadas no Redis com tempo de expiração curto.
