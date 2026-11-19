import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { connections } from "@/db/schema";

/** Busca uma conexão garantindo que ela pertence ao usuário. */
export async function findOwnedConnection(userId: string, where: { id?: string; pluggyItemId?: string }) {
  const condition = where.id
    ? eq(connections.id, where.id)
    : where.pluggyItemId
      ? eq(connections.pluggyItemId, where.pluggyItemId)
      : undefined;
  if (!condition) return null;
  const [row] = await getDb()
    .select()
    .from(connections)
    .where(and(eq(connections.userId, userId), condition))
    .limit(1);
  return row ?? null;
}
