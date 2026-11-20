import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog, users } from "@/db/schema";

/** Retorna o id interno do usuário, criando o registro no primeiro acesso. */
export async function getOrCreateUserId(email: string): Promise<string> {
  const db = getDb();
  const normalized = email.toLowerCase();
  const inserted = await db
    .insert(users)
    .values({ email: normalized })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (inserted[0]) return inserted[0].id;

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).limit(1);
  if (!existing[0]) throw new Error("Usuário não encontrado após criação");
  return existing[0].id;
}

/** Registra uma ação sensível. `details` nunca deve conter valores ou tokens. */
export async function audit(userId: string | null, action: string, details?: Record<string, unknown>) {
  await getDb().insert(auditLog).values({ userId, action, details: details ?? null });
}
