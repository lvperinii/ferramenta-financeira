// Verificação "otimista" de sessão em todas as rotas (só lê o cookie).
// Não é a única barreira: cada rota de API e cada página protegida
// também chama `auth()` antes de acessar dados (ver src/lib/session.ts).
export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    // Tudo, exceto: rotas do Auth.js, página de login, webhooks
    // (autenticados por segredo próprio) e arquivos estáticos.
    "/((?!api/auth|api/webhooks|login|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
