import { Suspense } from "react";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { getSessionEmail } from "@/lib/session";
import styles from "./page.module.css";

async function Painel() {
  // Verificação definitiva no servidor (o proxy é só uma pré-checagem).
  const email = await getSessionEmail();
  if (!email) redirect("/login");

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <>
      <p>Conectado como {email}</p>
      <section className={styles.card}>
        <h2>Próximos passos</h2>
        <ol>
          <li>Conectar bancos via Pluggy (Fase 1)</li>
          <li>Gastos por categoria (Fase 2)</li>
          <li>Orçamento mensal (Fase 3)</li>
          <li>Saldo e patrimônio (Fase 4)</li>
          <li>Gráficos e relatórios (Fase 5)</li>
        </ol>
      </section>
      <form action={sair}>
        <button type="submit" className={styles.button}>
          Sair
        </button>
      </form>
    </>
  );
}

export default function Home() {
  return (
    <main className={styles.main}>
      <h1>Controle Financeiro</h1>
      <Suspense fallback={<p>Carregando…</p>}>
        <Painel />
      </Suspense>
    </main>
  );
}
