import "server-only";
import { z } from "zod";

/**
 * Variáveis de ambiente do servidor, validadas na primeira leitura.
 * Nunca importe este módulo em componentes de cliente.
 */
const serverEnvSchema = z.object({
  // Auth.js (login com Google)
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET precisa ter pelo menos 32 caracteres"),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),
  // Lista de e-mails Google autorizados, separados por vírgula
  ALLOWED_EMAILS: z
    .string()
    .min(1, "Defina ao menos um e-mail em ALLOWED_EMAILS")
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),

  // Pluggy (Open Finance) — usadas só no servidor
  PLUGGY_CLIENT_ID: z.string().min(1),
  PLUGGY_CLIENT_SECRET: z.string().min(1),
  // Segredo que compõe a URL do webhook: /api/webhooks/pluggy/<segredo>
  PLUGGY_WEBHOOK_SECRET: z.string().min(32, "PLUGGY_WEBHOOK_SECRET precisa ter pelo menos 32 caracteres").optional(),
  // Mostra o banco de testes da Pluggy no widget ("true" em desenvolvimento)
  PLUGGY_INCLUDE_SANDBOX: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // Endereço público do app (ex.: https://meu-app.vercel.app), usado no webhook
  APP_URL: z.url().optional(),

  // Banco de dados (Neon Postgres). Pooled para o app; direct para migrações.
  DATABASE_URL: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Mostra só os nomes das variáveis com problema, nunca os valores.
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Configuração de ambiente inválida: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}
