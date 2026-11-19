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
 * Identificador do usuário enviado à Pluggy (clientUserId).
 * É um HMAC do e-mail, para não enviar o e-mail em si a terceiros.
 */
export function pluggyUserId(email: string): string {
  const { AUTH_SECRET } = getServerEnv();
  return createHmac("sha256", AUTH_SECRET).update(email.toLowerCase()).digest("hex");
}
