import "server-only";
import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import type { Account, CreditCardBills, Investment, Transaction } from "pluggy-sdk";
import { getDb } from "@/db";
import { accounts, connections, creditCardBills, investments, transactions } from "@/db/schema";
import { signedAmount, toMoney } from "@/lib/money";
import { getPluggyClient, isPluggyNotFound } from "@/lib/pluggy";

/** Janela de transações buscada a cada sincronização. */
const SYNC_WINDOW_DAYS = 365;
const BATCH_SIZE = 200;
const IN_PROGRESS_STATUSES = new Set(["UPDATING", "MERGING"]);

export type SyncResult =
  | { status: "synced"; accounts: number; transactions: number; investments: number; bills: number }
  | { status: "not_ready"; itemStatus: string }
  | { status: "deleted" };

function isoDate(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function windowStart(): string {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - SYNC_WINDOW_DAYS);
  return isoDate(start);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** Busca todas as páginas de investimentos de um item. */
async function fetchAllInvestments(itemId: string): Promise<Investment[]> {
  const client = getPluggyClient();
  const all: Investment[] = [];
  let page = 1;
  for (;;) {
    const response = await client.fetchInvestments(itemId, undefined, { page, pageSize: 100 });
    all.push(...response.results);
    if (page >= response.totalPages || response.results.length === 0) break;
    page += 1;
  }
  return all;
}

/** Busca todas as páginas de faturas de um cartão. */
async function fetchAllBills(accountId: string): Promise<CreditCardBills[]> {
  const client = getPluggyClient();
  const all: CreditCardBills[] = [];
  let page = 1;
  for (;;) {
    const response = await client.fetchCreditCardBills(accountId, { page, pageSize: 100 });
    all.push(...response.results);
    if (page >= response.totalPages || response.results.length === 0) break;
    page += 1;
  }
  return all;
}

/**
 * Sincroniza uma conexão: SEMPRE busca os dados na API da Pluggy
 * (nunca confia no conteúdo de um webhook) e grava com upsert.
 * Transações dentro da janela que sumiram na Pluggy são apagadas aqui também.
 */
export async function syncConnection(connectionId: string): Promise<SyncResult> {
  const db = getDb();
  const client = getPluggyClient();

  const [connection] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!connection) throw new Error("Conexão não encontrada");

  let item;
  try {
    item = await client.fetchItem(connection.pluggyItemId);
  } catch (error) {
    if (isPluggyNotFound(error)) {
      // O item não existe mais na Pluggy: remove os dados locais (cascade).
      await db.delete(connections).where(eq(connections.id, connection.id));
      return { status: "deleted" };
    }
    throw error;
  }

  await db
    .update(connections)
    .set({
      status: item.status,
      connectorName: item.connector?.name ?? connection.connectorName,
      executionStatus: item.executionStatus ?? null,
      statusDetail: item.statusDetail ?? null,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, connection.id));

  // Durante uma atualização em andamento os dados podem estar pela metade.
  // Nos demais status (inclusive OUTDATED = "erro na última execução" e
  // LOGIN_ERROR) a Pluggy ainda serve o que foi coletado antes, então lemos.
  if (IN_PROGRESS_STATUSES.has(item.status)) {
    return { status: "not_ready", itemStatus: item.status };
  }

  // ---- Contas ----
  const accountPage = await client.fetchAccounts(item.id);
  const remoteAccounts: Account[] = accountPage.results;
  const accountIdByPluggyId = new Map<string, string>();

  for (const account of remoteAccounts) {
    const values = {
      connectionId: connection.id,
      pluggyAccountId: account.id,
      type: account.type,
      subtype: account.subtype ?? null,
      name: account.marketingName ?? account.name,
      currencyCode: account.currencyCode ?? "BRL",
      balance: toMoney(account.balance) ?? "0.00",
      creditLimit: toMoney(account.creditData?.creditLimit ?? null),
      updatedAt: new Date(),
    };
    const [saved] = await db
      .insert(accounts)
      .values(values)
      .onConflictDoUpdate({
        target: accounts.pluggyAccountId,
        set: {
          type: values.type,
          subtype: values.subtype,
          name: values.name,
          currencyCode: values.currencyCode,
          balance: values.balance,
          creditLimit: values.creditLimit,
          updatedAt: values.updatedAt,
        },
        // Nunca "rouba" uma conta de outra conexão.
        setWhere: eq(accounts.connectionId, connection.id),
      })
      .returning({ id: accounts.id });
    if (saved) accountIdByPluggyId.set(account.id, saved.id);
  }

  // Contas que deixaram de existir na Pluggy
  const remoteAccountIds = remoteAccounts.map((a) => a.id);
  await db
    .delete(accounts)
    .where(
      remoteAccountIds.length > 0
        ? and(eq(accounts.connectionId, connection.id), notInArray(accounts.pluggyAccountId, remoteAccountIds))
        : eq(accounts.connectionId, connection.id),
    );

  // ---- Transações ----
  const dateFrom = windowStart();
  let transactionCount = 0;

  for (const [pluggyAccountId, localAccountId] of accountIdByPluggyId) {
    const remote: Transaction[] = await client.fetchAllTransactions(pluggyAccountId, { dateFrom });
    transactionCount += remote.length;

    for (const batch of chunks(remote, BATCH_SIZE)) {
      await db
        .insert(transactions)
        .values(
          batch.map((t) => ({
            accountId: localAccountId,
            pluggyTransactionId: t.id,
            date: isoDate(t.date),
            description: t.description,
            amount: signedAmount(t.amount, t.type),
            currencyCode: t.currencyCode ?? "BRL",
            pluggyCategory: t.category,
            status: t.status ?? null,
            purchaseDate: t.creditCardMetadata?.purchaseDate ? isoDate(t.creditCardMetadata.purchaseDate) : null,
            installmentNumber: t.creditCardMetadata?.installmentNumber ?? null,
            totalInstallments: t.creditCardMetadata?.totalInstallments ?? null,
            pluggyBillId: t.creditCardMetadata?.billId ?? null,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: transactions.pluggyTransactionId,
          // Não sobrescreve categoryId: a categoria escolhida por você é preservada.
          set: {
            date: sql`excluded.date`,
            description: sql`excluded.description`,
            amount: sql`excluded.amount`,
            currencyCode: sql`excluded.currency_code`,
            pluggyCategory: sql`excluded.pluggy_category`,
            status: sql`excluded.status`,
            purchaseDate: sql`excluded.purchase_date`,
            installmentNumber: sql`excluded.installment_number`,
            totalInstallments: sql`excluded.total_installments`,
            pluggyBillId: sql`excluded.pluggy_bill_id`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: eq(transactions.accountId, localAccountId),
        });
    }

    // Transações da janela que não existem mais na Pluggy
    const remoteIds = remote.map((t) => t.id);
    const inWindow = and(eq(transactions.accountId, localAccountId), gte(transactions.date, dateFrom));
    if (remoteIds.length === 0) {
      await db.delete(transactions).where(inWindow);
    } else {
      // Busca os ids locais da janela e apaga os ausentes em lotes
      const local = await db
        .select({ id: transactions.id, pluggyId: transactions.pluggyTransactionId })
        .from(transactions)
        .where(inWindow);
      const remoteSet = new Set(remoteIds);
      const stale = local.filter((row) => !remoteSet.has(row.pluggyId)).map((row) => row.id);
      for (const batch of chunks(stale, BATCH_SIZE)) {
        await db.delete(transactions).where(inArray(transactions.id, batch));
      }
    }
  }

  // ---- Faturas de cartão ----
  // Nem todo banco oferece faturas; uma falha aqui não interrompe a sincronização.
  let billCount = 0;
  for (const account of remoteAccounts) {
    if (account.type !== "CREDIT") continue;
    const localAccountId = accountIdByPluggyId.get(account.id);
    if (!localAccountId) continue;
    let bills: CreditCardBills[];
    try {
      bills = await fetchAllBills(account.id);
    } catch (error) {
      console.error("sync: faturas indisponíveis", error instanceof Error ? error.name : "unknown");
      continue;
    }
    billCount += bills.length;
    for (const batch of chunks(bills, BATCH_SIZE)) {
      await db
        .insert(creditCardBills)
        .values(
          batch.map((b) => ({
            accountId: localAccountId,
            pluggyBillId: b.id,
            dueDate: isoDate(b.dueDate),
            closingDate: b.billClosingDate ? isoDate(b.billClosingDate) : null,
            totalAmount: toMoney(b.totalAmount),
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: creditCardBills.pluggyBillId,
          set: {
            dueDate: sql`excluded.due_date`,
            closingDate: sql`excluded.closing_date`,
            totalAmount: sql`excluded.total_amount`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: eq(creditCardBills.accountId, localAccountId),
        });
    }
  }

  // ---- Investimentos ----
  const remoteInvestments = await fetchAllInvestments(item.id);
  for (const batch of chunks(remoteInvestments, BATCH_SIZE)) {
    await db
      .insert(investments)
      .values(
        batch.map((inv) => ({
          connectionId: connection.id,
          pluggyInvestmentId: inv.id,
          type: inv.type,
          name: inv.name,
          balance: toMoney(inv.balance) ?? "0.00",
          currencyCode: inv.currencyCode ?? "BRL",
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: investments.pluggyInvestmentId,
        set: {
          type: sql`excluded.type`,
          name: sql`excluded.name`,
          balance: sql`excluded.balance`,
          currencyCode: sql`excluded.currency_code`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: eq(investments.connectionId, connection.id),
      });
  }
  const remoteInvestmentIds = remoteInvestments.map((inv) => inv.id);
  await db
    .delete(investments)
    .where(
      remoteInvestmentIds.length > 0
        ? and(eq(investments.connectionId, connection.id), notInArray(investments.pluggyInvestmentId, remoteInvestmentIds))
        : eq(investments.connectionId, connection.id),
    );

  await db.update(connections).set({ lastSyncedAt: new Date() }).where(eq(connections.id, connection.id));

  return {
    status: "synced",
    accounts: remoteAccounts.length,
    transactions: transactionCount,
    investments: remoteInvestments.length,
    bills: billCount,
  };
}
