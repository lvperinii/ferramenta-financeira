import "server-only";
import { createHmac } from "node:crypto";
import { PluggyClient } from "pluggy-sdk";
import { getServerEnv } from "@/lib/env";

let client: PluggyClient | undefined;

/** Cliente da Pluggy com as credenciais completas — uso exclusivo no servidor. */
export function getPluggyClient(): PluggyClient {
  if (client) return client;
  const env = getServerEnv();
  client = new PluggyClient({
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  });
  return client;
}

/**
 * URL do webhook, ou undefined se o app ainda não tiver endereço HTTPS
 * público (ex.: rodando em localhost) ou o segredo não estiver configurado.
 */
export function pluggyWebhookUrl(): string | undefined {
  const { APP_URL, PLUGGY_WEBHOOK_SECRET } = getServerEnv();
  if (!APP_URL || !PLUGGY_WEBHOOK_SECRET || !APP_URL.startsWith("https://")) return undefined;
  return `${APP_URL.replace(/\/+$/, "")}/api/webhooks/pluggy/${PLUGGY_WEBHOOK_SECRET}`;
}

/**
 * O pluggy-sdk rejeita com o corpo da resposta de erro (não com um Error).
 * Considera "não encontrado" quando o corpo indica código/status 404.
 * [verificar] formato exato do corpo de erro na documentação da Pluggy.
 */
export function isPluggyNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const body = error as { code?: unknown; statusCode?: unknown; status?: unknown };
  return body.code === 404 || body.statusCode === 404 || body.status === 404;
}

/**
 * Identificador do usuário enviado à Pluggy (clientUserId).
 * É um HMAC do e-mail, para não enviar o e-mail em si a terceiros.
 */
export function pluggyUserId(email: string): string {
  const { AUTH_SECRET } = getServerEnv();
  return createHmac("sha256", AUTH_SECRET).update(email.toLowerCase()).digest("hex");
}
