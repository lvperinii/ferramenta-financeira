import { getServerEnv } from "@/lib/env";
import { getPluggyClient, pluggyUserId } from "@/lib/pluggy";
import { getSessionEmail, isSameOrigin } from "@/lib/session";

const noStore = { "Cache-Control": "no-store" };

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

  try {
    const env = getServerEnv();
    // Assinatura do pluggy-sdk 0.94: createConnectToken(itemId?, options?)
    const { accessToken } = await getPluggyClient().createConnectToken(undefined, {
      clientUserId: pluggyUserId(email),
      webhookUrl: env.PLUGGY_WEBHOOK_URL,
      avoidDuplicates: true,
    });
    return Response.json({ accessToken }, { headers: noStore });
  } catch (error) {
    // Registra só o tipo do erro; nunca credenciais ou respostas completas.
    console.error("connect-token: falha ao criar token", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "connect_token_failed" }, { status: 502, headers: noStore });
  }
}
