import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts, budgets, cards, categories, categoryRules, connections, fixedExpenses, incomes, transactions } from "@/db/schema";
import { monthOf, parseCents } from "@/lib/finance/core";
import { brlCents, monthLabel } from "@/lib/finance/format";
import { todaySaoPaulo } from "@/lib/finance/load";
import { getSessionEmail } from "@/lib/session";
import { getOrCreateUserId } from "@/lib/users";
import { Nav } from "../components/Nav";
import fin from "../finance.module.css";
import styles from "../page.module.css";
import {
  removerCartao,
  removerContaFixa,
  removerOrcamento,
  removerRegra,
  removerRenda,
  salvarCartao,
  salvarContaFixa,
  salvarOrcamento,
  salvarRegra,
  salvarRenda,
} from "./actions";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
type CardRow = typeof cards.$inferSelect;

function RemoveButton({ action, id, label = "remover" }: { action: (f: FormData) => Promise<void>; id: string; label?: string }) {
  return (
    <form action={action} className={fin.inline}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={fin.linkButton}>
        {label}
      </button>
    </form>
  );
}

function CardForm({ card, creditAccounts }: { card?: CardRow; creditAccounts: { id: string; name: string; connectorName: string | null }[] }) {
  return (
    <form action={salvarCartao} className={fin.form}>
      <input type="hidden" name="id" value={card?.id ?? ""} />
      <label>
        Nome
        <input name="name" required maxLength={80} defaultValue={card?.name ?? ""} placeholder="Ex.: Black do banco X" />
      </label>
      <label>
        Conta na Pluggy
        <select name="accountId" defaultValue={card?.accountId ?? ""}>
          <option value="">— não ligar agora —</option>
          {creditAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.connectorName ? ` (${a.connectorName})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Banco
        <input name="bank" maxLength={80} defaultValue={card?.bank ?? ""} />
      </label>
      <label>
        Emissor/bandeira
        <input name="issuer" maxLength={80} defaultValue={card?.issuer ?? ""} />
      </label>
      <label>
        Dia do fechamento
        <input name="closingDay" type="number" min={1} max={31} required defaultValue={card?.closingDay ?? ""} />
      </label>
      <label>
        Dia do vencimento
        <input name="dueDay" type="number" min={1} max={31} required defaultValue={card?.dueDay ?? ""} />
      </label>
      <label>
        Compra no dia do fechamento
        <select name="closingDayGoesTo" defaultValue={card?.closingDayGoesTo ?? "next"}>
          <option value="next">vai para a próxima fatura</option>
          <option value="current">entra na fatura que fecha</option>
        </select>
      </label>
      <label>
        Data das parcelas na Pluggy
        <select name="installmentDateMode" defaultValue={card?.installmentDateMode ?? "purchase"}>
          <option value="purchase">data da compra original</option>
          <option value="posting">data do mês lançado</option>
        </select>
      </label>
      <label>
        Pontos/cashback
        <input name="rewards" maxLength={120} defaultValue={card?.rewards ?? ""} placeholder="Ex.: 2,2 pts/US$" />
      </label>
      <button type="submit" className={styles.button}>
        {card ? "Salvar" : "Adicionar cartão"}
      </button>
    </form>
  );
}

async function Configuracoes({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const email = await getSessionEmail();
  if (!email) redirect("/login");
  const userId = await getOrCreateUserId(email);
  const db = getDb();
  const erro = (await searchParams).erro;
  const currentMonth = monthOf(todaySaoPaulo());

  const [myCards, creditAccounts, fixed, myIncomes, myBudgets, rules, pluggyCats] = await Promise.all([
    db.select().from(cards).where(eq(cards.userId, userId)).orderBy(cards.name),
    db
      .select({ id: accounts.id, name: accounts.name, connectorName: connections.connectorName })
      .from(accounts)
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .where(and(eq(connections.userId, userId), eq(accounts.type, "CREDIT")))
      .orderBy(accounts.name),
    db
      .select({ id: fixedExpenses.id, name: fixedExpenses.name, amount: fixedExpenses.amount, dueDay: fixedExpenses.dueDay, startMonth: fixedExpenses.startMonth, endMonth: fixedExpenses.endMonth, category: categories.name })
      .from(fixedExpenses)
      .leftJoin(categories, eq(fixedExpenses.categoryId, categories.id))
      .where(eq(fixedExpenses.userId, userId))
      .orderBy(fixedExpenses.dueDay),
    db.select().from(incomes).where(eq(incomes.userId, userId)).orderBy(desc(incomes.month)),
    db
      .select({ id: budgets.id, month: budgets.month, amount: budgets.limitAmount, category: categories.name })
      .from(budgets)
      .innerJoin(categories, eq(budgets.categoryId, categories.id))
      .where(eq(budgets.userId, userId))
      .orderBy(categories.name, desc(budgets.month)),
    db
      .select({ id: categoryRules.id, matchType: categoryRules.matchType, pattern: categoryRules.pattern, category: categories.name })
      .from(categoryRules)
      .innerJoin(categories, eq(categoryRules.categoryId, categories.id))
      .where(eq(categoryRules.userId, userId))
      .orderBy(categoryRules.createdAt),
    db
      .selectDistinct({ name: transactions.pluggyCategory })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .where(and(eq(connections.userId, userId), isNotNull(transactions.pluggyCategory)))
      .orderBy(transactions.pluggyCategory),
  ]);

  return (
    <>
      {typeof erro === "string" && <p className={fin.warning}>{erro}</p>}

      <section className={styles.card}>
        <h2>Cartões</h2>
        <p className={styles.muted}>
          O fechamento e o vencimento definem em que mês cada compra é paga. Confira as duas opções de cada cartão com uma fatura real: se as
          parcelas aparecerem no mês errado no Orçamento, troque a opção “Data das parcelas”.
        </p>
        {myCards.map((c) => (
          <div key={c.id} className={styles.listItem} style={{ display: "block" }}>
            <div className={styles.row}>
              <strong>{c.name}</strong>
              <RemoveButton action={removerCartao} id={c.id} />
            </div>
            <CardForm card={c} creditAccounts={creditAccounts} />
          </div>
        ))}
        <h3>Novo cartão</h3>
        <CardForm creditAccounts={creditAccounts} />
      </section>

      <section className={styles.card}>
        <h2>Renda mensal</h2>
        <p className={styles.muted}>Vale a partir do mês informado até o próximo registro. Marque “só neste mês” para 13º ou bônus.</p>
        <table className={styles.table}>
          <tbody>
            {myIncomes.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.oneOff ? "Só em " : "A partir de "}
                  {monthLabel(monthOf(i.month))}
                </td>
                <td className={styles.num}>{brlCents(parseCents(i.amount))}</td>
                <td className={styles.num}>
                  <RemoveButton action={removerRenda} id={i.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={salvarRenda} className={fin.form}>
          <label>
            Mês
            <input name="month" type="month" required defaultValue={currentMonth} />
          </label>
          <label>
            Valor (R$)
            <input name="amount" inputMode="decimal" required placeholder="15.000,00" />
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input name="oneOff" type="checkbox" /> só neste mês
          </label>
          <button type="submit" className={styles.button}>
            Salvar renda
          </button>
        </form>
      </section>

      <section className={styles.card}>
        <h2>Contas fixas (fora do cartão)</h2>
        <table className={styles.table}>
          <tbody>
            {fixed.map((f) => (
              <tr key={f.id}>
                <td>
                  {f.name}
                  <div className={styles.muted}>
                    {f.category ?? "Contas fixas"} · vence dia {f.dueDay}
                    {f.startMonth ? ` · de ${monthLabel(monthOf(f.startMonth))}` : ""}
                    {f.endMonth ? ` até ${monthLabel(monthOf(f.endMonth))}` : ""}
                  </div>
                </td>
                <td className={styles.num}>{brlCents(parseCents(f.amount))}</td>
                <td className={styles.num}>
                  <RemoveButton action={removerContaFixa} id={f.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={salvarContaFixa} className={fin.form}>
          <label>
            Nome
            <input name="name" required maxLength={80} placeholder="Aluguel" />
          </label>
          <label>
            Valor (R$)
            <input name="amount" inputMode="decimal" required placeholder="3.500,00" />
          </label>
          <label>
            Dia do vencimento
            <input name="dueDay" type="number" min={1} max={31} required />
          </label>
          <label>
            Categoria
            <input name="category" required maxLength={80} list="categorias" placeholder="Moradia" />
          </label>
          <label>
            Início (opcional)
            <input name="startMonth" type="month" />
          </label>
          <label>
            Fim (opcional)
            <input name="endMonth" type="month" />
          </label>
          <button type="submit" className={styles.button}>
            Adicionar conta fixa
          </button>
        </form>
      </section>

      <section className={styles.card}>
        <h2>Orçamento por categoria</h2>
        <p className={styles.muted}>Cada limite vale a partir do mês informado até um novo limite da mesma categoria.</p>
        <table className={styles.table}>
          <tbody>
            {myBudgets.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.category}
                  <div className={styles.muted}>a partir de {monthLabel(monthOf(b.month))}</div>
                </td>
                <td className={styles.num}>{brlCents(parseCents(b.amount))}</td>
                <td className={styles.num}>
                  <RemoveButton action={removerOrcamento} id={b.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={salvarOrcamento} className={fin.form}>
          <label>
            Categoria
            <input name="category" required maxLength={80} list="categorias" placeholder="Restaurantes" />
          </label>
          <label>
            Limite mensal (R$)
            <input name="amount" inputMode="decimal" required placeholder="1.200,00" />
          </label>
          <label>
            A partir de
            <input name="month" type="month" required defaultValue={currentMonth} />
          </label>
          <button type="submit" className={styles.button}>
            Salvar limite
          </button>
        </form>
      </section>

      <section className={styles.card}>
        <h2>Regras de categoria</h2>
        <p className={styles.muted}>
          Regras por trecho da descrição têm prioridade sobre as por categoria da Pluggy. Sem regra, vale a categoria que a Pluggy enviou.
        </p>
        <table className={styles.table}>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.matchType === "pluggy_category" ? "Categoria Pluggy = " : "Descrição contém "}“{r.pattern}”
                </td>
                <td>→ {r.category}</td>
                <td className={styles.num}>
                  <RemoveButton action={removerRegra} id={r.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={salvarRegra} className={fin.form}>
          <label>
            Tipo
            <select name="matchType" defaultValue="description">
              <option value="description">descrição contém</option>
              <option value="pluggy_category">categoria da Pluggy é</option>
            </select>
          </label>
          <label>
            Texto
            <input name="pattern" required maxLength={80} list="categorias-pluggy" placeholder="IFOOD" />
          </label>
          <label>
            Sua categoria
            <input name="category" required maxLength={80} list="categorias" placeholder="Restaurantes" />
          </label>
          <button type="submit" className={styles.button}>
            Adicionar regra
          </button>
        </form>
        {pluggyCats.length > 0 && (
          <p className={styles.muted}>Categorias recebidas da Pluggy: {pluggyCats.map((c) => c.name).join(", ")}</p>
        )}
      </section>

      <datalist id="categorias">
        {[...new Set([...myBudgets.map((b) => b.category), ...fixed.map((f) => f.category ?? ""), ...rules.map((r) => r.category)])]
          .filter(Boolean)
          .map((c) => (
            <option key={c} value={c} />
          ))}
      </datalist>
      <datalist id="categorias-pluggy">
        {pluggyCats.map((c) => (
          <option key={c.name} value={c.name ?? ""} />
        ))}
      </datalist>
    </>
  );
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className={styles.main}>
      <Nav current="/configuracoes" />
      <h1>Configurações</h1>
      <Suspense fallback={<p>Carregando…</p>}>
        <Configuracoes searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
