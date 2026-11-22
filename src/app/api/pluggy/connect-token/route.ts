import { z } from "zod";
import { findOwnedConnection } from "@/lib/connections";
import { getPluggyClient, pluggyUserId, pluggyWebhookUrl } from "@/lib/pluggy";
import { getSessionEmail, isSameOrigin, readJson } from "@/lib/session";
import { getOrCreateUserId } from "@/lib/users";

const noStore = { "Cache-Control": "no-store" };

// Corpo opcional: { connectionId } para reconectar um banco existente.
const bodySchema = z.object({ connectionId: z.uuid().optional() }).strict();

/**
 * Cria um Connect Token (validade curta, sem acesso a dados) para o
 * widget Pluggy Connect no navegador. As credenciais da Pluggy nunca
 * saem do servidor.
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

  try {
    // Reconexão: só para uma conexão que pertence a você.
    let itemId: string | undefined;
    if (parsed.data.connectionId) {
      const userId = await getOrCreateUserId(email);
      const connection = await findOwnedConnection(userId, { id: parsed.data.connectionId });
      if (!connection) return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
      itemId = connection.pluggyItemId;
    }

    // Assinatura do pluggy-sdk 0.94: createConnectToken(itemId?, options?)
    const { accessToken } = await getPluggyClient().createConnectToken(itemId, {
      clientUserId: pluggyUserId(email),
      webhookUrl: pluggyWebhookUrl(),
      // Sem avoidDuplicates: o MeuPluggy exige um item por banco, todos do mesmo
      // conector e usuário, e a opção bloqueava a 2ª conexão. Reconectar um banco
      // existente continua atualizando o mesmo item (itemId acima).
    });
    return Response.json({ accessToken, itemId: itemId ?? null }, { headers: noStore });
  } catch (error) {
    // Registra só o tipo do erro; nunca credenciais ou respostas completas.
    console.error("connect-token: falha ao criar token", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "connect_token_failed" }, { status: 502, headers: noStore });
  }
}
