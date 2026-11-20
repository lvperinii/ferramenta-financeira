import { eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { connections } from "@/db/schema";
import { getPluggyClient, isPluggyNotFound, pluggyUserId } from "@/lib/pluggy";
import { getSessionEmail, isSameOrigin, readJson } from "@/lib/session";
import { syncConnection } from "@/lib/sync";
import { audit, getOrCreateUserId } from "@/lib/users";

const noStore = { "Cache-Control": "no-store" };
const bodySchema = z.object({ itemId: z.uuid() }).strict();

export const maxDuration = 60;

/**
 * Registra um banco recém-conectado pelo widget.
 * O itemId vem do navegador, então é conferido na Pluggy: o item precisa
 * ter sido criado com o SEU clientUserId — senão é recusado.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: noStore });
  }
  const email = await getSessionEmail();
  if (!email) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: noStore });
  }

  let item;
  try {
    item = await getPluggyClient().fetchItem(parsed.data.itemId);
  } catch (error) {
    if (isPluggyNotFound(error)) return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
    console.error("items: falha ao consultar item", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "pluggy_unavailable" }, { status: 502, headers: noStore });
  }

  if (item.clientUserId !== pluggyUserId(email)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: noStore });
  }

  const userId = await getOrCreateUserId(email);
  const [saved] = await getDb()
    .insert(connections)
    .values({
      userId,
      pluggyItemId: item.id,
      connectorName: item.connector?.name ?? null,
      status: item.status,
    })
    .onConflictDoUpdate({
      target: connections.pluggyItemId,
      set: { status: item.status, connectorName: item.connector?.name ?? null, updatedAt: new Date() },
      // Só atualiza se a conexão já for sua.
      setWhere: eq(connections.userId, userId),
    })
    .returning({ id: connections.id, userId: connections.userId });

  if (!saved || saved.userId !== userId) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: noStore });
  }

  await audit(userId, "connection.created", { connectionId: saved.id, connector: item.connector?.name ?? null });

  // Primeira sincronização depois da resposta (o webhook também fará isso).
  after(async () => {
    try {
      await syncConnection(saved.id);
    } catch (error) {
      console.error("items: falha na sincronização inicial", error instanceof Error ? error.name : "unknown");
    }
  });

  return Response.json({ connectionId: saved.id, status: item.status }, { status: 201, headers: noStore });
}
