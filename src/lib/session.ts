import "server-only";
import { auth } from "@/auth";

/** Retorna o e-mail do usuário logado, ou null se não houver sessão válida. */
export async function getSessionEmail(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  return email ?? null;
}

/**
 * Proteção contra CSRF em rotas que alteram estado: a requisição precisa
 * vir da mesma origem do app. (Os cookies de sessão também são SameSite=Lax.)
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
