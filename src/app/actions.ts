"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { connections } from "@/db/schema";
import { findOwnedConnection } from "@/lib/connections";
import { getPluggyClient, isPluggyNotFound } from "@/lib/pluggy";
import { getSessionEmail } from "@/lib/session";
import { syncConnection } from "@/lib/sync";
import { audit, getOrCreateUserId } from "@/lib/users";

/** Intervalo mínimo entre sincronizações manuais da mesma conexão. */
const MIN_MANUAL_SYNC_MS = 5 * 60 * 1000;

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const idSchema = z.uuid();

async function requireUserId(): Promise<string> {
  // Server Actions são endpoints públicos: sempre verificar a sessão aqui.
  const email = await getSessionEmail();
  if (!email) throw new Error("Não autenticado");
  return getOrCreateUserId(email);
}

export async function sincronizarAgora(connectionId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = idSchema.safeParse(connectionId);
  if (!id.success) return { ok: false, message: "Conexão inválida." };

  const connection = await findOwnedConnection(userId, { id: id.data });
  if (!connection) return { ok: false, message: "Conexão não encontrada." };

  if (connection.lastSyncedAt && Date.now() - connection.lastSyncedAt.getTime() < MIN_MANUAL_SYNC_MS) {
    return { ok: false, message: "Sincronizado há pouco. Aguarde alguns minutos para tentar de novo." };
  }

  try {
    const result = await syncConnection(connection.id);
    refresh();
    if (result.status === "synced") {
      return { ok: true, message: `Atualizado: ${result.accounts} conta(s), ${result.transactions} transação(ões), ${result.investments} investimento(s).` };
    }
    if (result.status === "deleted") return { ok: true, message: "A conexão não existe mais na Pluggy e foi removida." };
    return { ok: false, message: `O banco ainda não está pronto (status: ${result.itemStatus}).` };
  } catch (error) {
    console.error("sincronizarAgora: falha", error instanceof Error ? error.name : "unknown");
    return { ok: false, message: "Não foi possível sincronizar agora. Tente mais tarde." };
  }
}

export async function removerConexao(connectionId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = idSchema.safeParse(connectionId);
  if (!id.success) return { ok: false, message: "Conexão inválida." };

  const connection = await findOwnedConnection(userId, { id: id.data });
  if (!connection) return { ok: false, message: "Conexão não encontrada." };

  try {
    // LGPD: revoga o acesso na Pluggy, que apaga os dados de lá.
    await getPluggyClient().deleteItem(connection.pluggyItemId);
  } catch (error) {
    if (!isPluggyNotFound(error)) {
      console.error("removerConexao: falha na Pluggy", error instanceof Error ? error.name : "unknown");
      return { ok: false, message: "Não foi possível remover na Pluggy. Nada foi apagado; tente de novo." };
    }
  }

  // Apaga contas, transações e investimentos locais (ON DELETE CASCADE).
  await getDb().delete(connections).where(eq(connections.id, connection.id));
  await audit(userId, "connection.deleted", { connector: connection.connectorName });
  refresh();
  return { ok: true, message: "Banco desconectado e dados apagados." };
}
