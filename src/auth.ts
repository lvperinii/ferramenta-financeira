import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Login exclusivo com Google, restrito aos e-mails de ALLOWED_EMAILS.
 * O 2º fator fica a cargo da conta Google (ative a verificação em duas etapas).
 *
 * Lê process.env diretamente porque este módulo também roda no proxy.
 */
function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 horas
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      const email = profile?.email?.toLowerCase();
      if (!email || profile?.email_verified !== true) return false;
      return allowedEmails().includes(email);
    },
    // Usado pelo proxy: só deixa passar quem tem sessão válida.
    authorized({ auth: session, request }) {
      if (session?.user) return true;
      // APIs respondem 401 em vez de redirecionar para a página de login.
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
      }
      return false;
    },
  },
});
