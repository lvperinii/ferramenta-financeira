import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { connections, webhookEvents } from "@/db/schema";
import { getServerEnv } from "@/lib/env";
import { readJson } from "@/lib/session";
import { syncConnection } from "@/lib/sync";

export const maxDuration = 60;

/**
 * Formato mínimo que usamos do aviso da Pluggy. Campos extras são aceitos
 * mas NUNCA usados como dados: a sincronização sempre busca tudo de novo
 * na API da Pluggy com a nossa própria chave.
 */
const eventSchema = z.object({
  event: z.string().min(1).max(100),
  eventId: z.string().min(1).max(200),
  itemId: z.uuid().optional(),
});

/** Compara segredos em tempo constante (hash antes, para tamanhos iguais). */
function secretMatches(received: string, expected: string): boolean {
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const ok = () => Response.json({ received: true }, { headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/pluggy/[secret]">) {
  const { secret } = await ctx.params;
  const expected = getServerEnv().PLUGGY_WEBHOOK_SECRET;
  // Segredo errado ou não configurado: 404, sem revelar que a rota existe.
  if (!expected || !secretMatches(secret, expected)) {
    return new Response(null, { status: 404 });
  }

  const parsed = eventSchema.safeParse(await readJson(request, 64 * 1024));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const { event, eventId, itemId } = parsed.data;

  // Idempotência: o mesmo eventId só é registrado (e processado) uma vez.
  const [stored] = await getDb()
    .insert(webhookEvents)
    .values({ eventId, event, itemId: itemId ?? null, payload: { event, eventId, itemId: itemId ?? null } })
    .onConflictDoNothing({ target: webhookEvents.eventId })
    .returning({ id: webhookEvents.id });
  if (!stored) return ok(); // repetido

  // Responde rápido (a Pluggy espera resposta em poucos segundos) e processa depois.
  after(() => processEvent(stored.id, itemId));
  return ok();
}

async function processEvent(webhookEventId: string, itemId: string | undefined) {
  const db = getDb();
  let error: string | null = null;
  try {
    if (!itemId) {
      error = "evento sem itemId (ignorado)";
    } else {
      const [connection] = await db
        .select({ id: connections.id })
        .from(connections)
        .where(eq(connections.pluggyItemId, itemId))
        .limit(1);
      if (!connection) {
        // Item desconhecido: ignora (pode ser aviso falso ou de outro app).
        error = "item desconhecido (ignorado)";
      } else {
        // Qualquer evento de um item conhecido = ressincronizar a partir da API.
        await syncConnection(connection.id);
      }
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.name : "erro desconhecido";
    console.error("webhook: falha ao processar evento", error);
  }
  await db.update(webhookEvents).set({ processedAt: new Date(), error }).where(eq(webhookEvents.id, webhookEventId));
}
