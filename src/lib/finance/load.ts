import "server-only";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  accounts,
  budgets,
  cards,
  categories,
  categoryRules,
  connections,
  creditCardBills,
  fixedExpenses,
  incomes,
  transactions,
} from "@/db/schema";
import {
  type CardRules,
  type CardTransaction,
  type CategoryRule,
  type Entry,
  type MonthlyValue,
  addMonths,
  cardEntries,
  categorize,
  fixedEntries,
  monthOf,
  parseCents,
  projectInstallments,
  valueForMonth,
} from "./core";

/** Hoje no fuso de São Paulo, "AAAA-MM-DD". */
export function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export type FinanceData = {
  today: string;
  entries: Entry[];
  cards: CardRules[];
  cardNames: Map<string, string>;
  warnings: string[];
  incomeFor: (month: string) => number;
  budgetsFor: (month: string) => Map<string, number>;
};

/** Carrega tudo do usuário e monta os lançamentos por competência. Toda consulta filtra por `userId`. */
export async function loadFinance(userId: string): Promise<FinanceData> {
  const db = getDb();
  const today = todaySaoPaulo();
  const currentMonth = monthOf(today);

  const myCards = await db.select().from(cards).where(eq(cards.userId, userId)).orderBy(cards.name);

  const creditAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(and(eq(connections.userId, userId), eq(accounts.type, "CREDIT")));

  const ownAccountIds = new Set(creditAccounts.map((a) => a.id));
  const cardByAccount = new Map<string, string>();
  for (const c of myCards) if (c.accountId && ownAccountIds.has(c.accountId)) cardByAccount.set(c.accountId, c.id);

  const warnings: string[] = [];
  for (const a of creditAccounts) {
    if (!cardByAccount.has(a.id)) warnings.push(`O cartão "${a.name}" ainda não tem fechamento/vencimento cadastrados (Configurações).`);
  }
  for (const c of myCards) {
    if (!c.accountId) warnings.push(`O cartão "${c.name}" não está ligado a nenhuma conta da Pluggy.`);
  }

  const rules: CategoryRule[] = (
    await db
      .select({ matchType: categoryRules.matchType, pattern: categoryRules.pattern, category: categories.name })
      .from(categoryRules)
      .innerJoin(categories, eq(categoryRules.categoryId, categories.id))
      .where(eq(categoryRules.userId, userId))
  ).map((r) => ({ ...r, matchType: r.matchType === "pluggy_category" ? "pluggy_category" : "description" }));

  const linkedAccountIds = [...cardByAccount.keys()];
  let cardTxs: CardTransaction[] = [];
  if (linkedAccountIds.length > 0) {
    const since = `${addMonths(currentMonth, -13)}-01`;
    const billDue = new Map(
      (
        await db
          .select({ pluggyBillId: creditCardBills.pluggyBillId, dueDate: creditCardBills.dueDate })
          .from(creditCardBills)
          .where(inArray(creditCardBills.accountId, linkedAccountIds))
      ).map((b) => [b.pluggyBillId, b.dueDate]),
    );
    const rows = await db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        purchaseDate: transactions.purchaseDate,
        description: transactions.description,
        amount: transactions.amount,
        installmentNumber: transactions.installmentNumber,
        totalInstallments: transactions.totalInstallments,
        pluggyBillId: transactions.pluggyBillId,
        pluggyCategory: transactions.pluggyCategory,
        manualCategory: categories.name,
      })
      .from(transactions)
      .leftJoin(categories, and(eq(transactions.categoryId, categories.id), eq(categories.userId, userId)))
      .where(and(inArray(transactions.accountId, linkedAccountIds), gte(transactions.date, since)));
    cardTxs = rows.map((r) => ({
      id: r.id,
      cardId: cardByAccount.get(r.accountId) ?? "",
      date: r.date,
      purchaseDate: r.purchaseDate,
      description: r.description,
      amountCents: parseCents(r.amount),
      installmentNumber: r.installmentNumber,
      totalInstallments: r.totalInstallments,
      billDueDate: r.pluggyBillId ? (billDue.get(r.pluggyBillId) ?? null) : null,
      category: categorize(r.description, r.pluggyCategory, rules, r.manualCategory),
    }));
  }

  const cardRules: CardRules[] = myCards.map((c) => ({
    id: c.id,
    name: c.name,
    closingDay: c.closingDay,
    dueDay: c.dueDay,
    closingDayGoesTo: c.closingDayGoesTo === "current" ? "current" : "next",
    installmentDateMode: c.installmentDateMode === "posting" ? "posting" : "purchase",
    rewards: c.rewards,
  }));
  const real = cardEntries(cardTxs, new Map(cardRules.map((c) => [c.id, c])));

  const fixedRows = await db
    .select({
      id: fixedExpenses.id,
      name: fixedExpenses.name,
      amount: fixedExpenses.amount,
      dueDay: fixedExpenses.dueDay,
      startMonth: fixedExpenses.startMonth,
      endMonth: fixedExpenses.endMonth,
      category: categories.name,
    })
    .from(fixedExpenses)
    .leftJoin(categories, eq(fixedExpenses.categoryId, categories.id))
    .where(eq(fixedExpenses.userId, userId));
  const months = Array.from({ length: 26 }, (_, i) => addMonths(currentMonth, i - 13));
  const fixed = fixedEntries(
    fixedRows.map((f) => ({
      id: f.id,
      name: f.name,
      cents: parseCents(f.amount),
      dueDay: f.dueDay,
      category: f.category ?? "Contas fixas",
      startMonth: f.startMonth ? monthOf(f.startMonth) : null,
      endMonth: f.endMonth ? monthOf(f.endMonth) : null,
    })),
    months,
  );

  const incomeValues: MonthlyValue[] = (await db.select().from(incomes).where(eq(incomes.userId, userId))).map((i) => ({
    month: monthOf(i.month),
    cents: parseCents(i.amount),
    oneOff: i.oneOff,
  }));

  const budgetRows = await db
    .select({ category: categories.name, month: budgets.month, amount: budgets.limitAmount })
    .from(budgets)
    .innerJoin(categories, eq(budgets.categoryId, categories.id))
    .where(and(eq(budgets.userId, userId), isNotNull(budgets.month)));
  const budgetsByCategory = new Map<string, MonthlyValue[]>();
  for (const b of budgetRows) {
    const list = budgetsByCategory.get(b.category) ?? [];
    list.push({ month: monthOf(b.month), cents: parseCents(b.amount) });
    budgetsByCategory.set(b.category, list);
  }

  return {
    today,
    entries: [...real, ...projectInstallments(real), ...fixed],
    cards: cardRules,
    cardNames: new Map(cardRules.map((c) => [c.id, c.name])),
    warnings,
    incomeFor: (month) => valueForMonth(incomeValues, month),
    budgetsFor: (month) => {
      const m = new Map<string, number>();
      for (const [category, values] of budgetsByCategory) {
        const v = valueForMonth(values, month);
        if (v > 0) m.set(category, v);
      }
      return m;
    },
  };
}
