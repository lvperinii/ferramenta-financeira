import { Suspense } from "react";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { signOut } from "@/auth";
import { getDb } from "@/db";
import { accounts, connections, transactions } from "@/db/schema";
import { getServerEnv } from "@/lib/env";
import { formatBRL } from "@/lib/money";
import { getSessionEmail } from "@/lib/session";
import { getOrCreateUserId } from "@/lib/users";
import { ConnectBank } from "./components/ConnectBank";
import { ConnectionActions } from "./components/ConnectionActions";
import styles from "./page.module.css";

const STATUS_LABEL: Record<string, string> = {
  UPDATED: "Atualizado",
  UPDATING: "Atualizando…",
  MERGING: "Atualizando…",
  WAITING_USER_INPUT: "Aguardando sua confirmação",
  WAITING_USER_ACTION: "Aguardando sua ação",
  LOGIN_ERROR: "Erro de login — reconecte",
  OUTDATED: "Desatualizado",
};
const NEEDS_RECONNECT = new Set(["LOGIN_ERROR", "WAITING_USER_INPUT", "WAITING_USER_ACTION", "OUTDATED"]);

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const dateOnly = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" });

async function Painel() {
  // Verificação definitiva no servidor (o proxy é só uma pré-checagem).
  const email = await getSessionEmail();
  if (!email) redirect("/login");

  const env = getServerEnv();
  const userId = await getOrCreateUserId(email);
  const db = getDb();

  // Todas as consultas filtram pelo usuário logado.
  const myConnections = await db
    .select()
    .from(connections)
    .where(eq(connections.userId, userId))
    .orderBy(connections.createdAt);

  const myAccounts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      balance: accounts.balance,
      creditLimit: accounts.creditLimit,
      currencyCode: accounts.currencyCode,
      connectorName: connections.connectorName,
    })
    .from(accounts)
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(eq(connections.userId, userId))
    .orderBy(connections.connectorName, accounts.name);

  const recent = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      currencyCode: transactions.currencyCode,
      category: transactions.pluggyCategory,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(eq(connections.userId, userId))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(20);

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <>
      <div className={styles.row}>
        <p className={styles.muted}>Conectado como {email}</p>
        <form action={sair}>
          <button type="submit" className={styles.secondary}>
            Sair
          </button>
        </form>
      </div>

      <section className={styles.card}>
        <h2>Bancos conectados</h2>
        {myConnections.length === 0 && <p className={styles.muted}>Nenhum banco conectado ainda.</p>}
        <ul className={styles.list}>
          {myConnections.map((c) => (
            <li key={c.id} className={styles.listItem}>
              <div>
                <strong>{c.connectorName ?? "Banco"}</strong>
                <div className={styles.muted}>
                  {STATUS_LABEL[c.status] ?? c.status}
                  {c.lastSyncedAt ? ` · sincronizado em ${dateTime.format(c.lastSyncedAt)}` : " · ainda não sincronizado"}
                </div>
              </div>
              <div className={styles.row}>
                {NEEDS_RECONNECT.has(c.status) && (
                  <ConnectBank includeSandbox={env.PLUGGY_INCLUDE_SANDBOX} connectionId={c.id} label="Reconectar" />
                )}
                <ConnectionActions connectionId={c.id} connectorName={c.connectorName ?? "este banco"} />
              </div>
            </li>
          ))}
        </ul>
        <ConnectBank includeSandbox={env.PLUGGY_INCLUDE_SANDBOX} />
      </section>

      <section className={styles.card}>
        <h2>Contas</h2>
        {myAccounts.length === 0 ? (
          <p className={styles.muted}>As contas aparecem aqui depois da primeira sincronização.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Banco</th>
                <th className={styles.num}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {myAccounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.name}
                    {a.type === "CREDIT" && <span className={styles.muted}> (cartão)</span>}
                  </td>
                  <td>{a.connectorName ?? "—"}</td>
                  <td className={styles.num}>{formatBRL(a.balance, a.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <h2>Últimas transações</h2>
        {recent.length === 0 ? (
          <p className={styles.muted}>Nenhuma transação ainda.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th className={styles.num}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((t) => (
                <tr key={t.id}>
                  <td>{dateOnly.format(new Date(`${t.date}T00:00:00Z`))}</td>
                  <td>
                    {t.description}
                    <div className={styles.muted}>{t.accountName}</div>
                  </td>
                  <td>{t.category ?? "—"}</td>
                  <td className={`${styles.num} ${t.amount.startsWith("-") ? styles.negative : styles.positive}`}>
                    {formatBRL(t.amount, t.currencyCode)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
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
