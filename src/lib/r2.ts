import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config";
import * as fs from "node:fs/promises";
import { lookup } from "mime-types";

const R2_ENABLED =
  config.r2.endpoint &&
  config.r2.accessKeyId &&
  config.r2.secretAccessKey &&
  config.r2.bucket;

if (!R2_ENABLED) {
  console.warn(
    "⚠️  Configurações do Cloudflare R2 não estão completas. Funções do R2 serão desativadas.",
  );
}

const R2 = new S3Client({
  region: "auto",
  endpoint: config.r2.endpoint, // Usamos o endpoint original do R2 para a conexão
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
  forcePathStyle: true, // Mantemos o path style para evitar subdomínios
});

/**
 * Gera URL pública para um arquivo no R2 usando o domínio CDN.
 * Use para arquivos públicos (áudio, imagens).
 */
export function getR2PublicUrl(key: string): string {
  if (!config.r2.publicUrl) {
    console.warn("[R2] No public URL configured, returning key as path");
    return `/${key}`;
  }
  const oldUrl = `${config.r2.endpoint}/${config.r2.bucket}`;

  return key.replace(oldUrl, config.r2.publicUrl);
}

export const R2Lib = {
  async uploadFile(localPath: string, key: string): Promise<string> {
    if (!R2_ENABLED) throw new Error("R2 não está configurado.");

    const fileContent = await fs.readFile(localPath);
    const contentType = lookup(localPath) || "application/octet-stream";

    const command = new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: fileContent,
      ContentType: contentType,
    });

    await R2.send(command);
    return key;
  },

  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<string> {
    if (!R2_ENABLED) throw new Error("R2 não está configurado.");

    const command = new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await R2.send(command);
    return key;
  },

  /**
   * Gera uma URL pré-assinada para acesso temporário a um objeto privado.
   * A URL aponta diretamente para o R2 endpoint para garantir que a assinatura seja válida.
   */
  async getPresignedUrl(
    key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    if (!R2_ENABLED) throw new Error("R2 não está configurado.");

    const command = new GetObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
    });

    const signedUrl = await getSignedUrl(R2, command, { expiresIn });

    // Retorna a URL assinada diretamente do R2
    // Não substituímos o hostname pois isso invalidaria a assinatura
    return getR2PublicUrl(signedUrl);
  },
};
