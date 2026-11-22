import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Valores monetários: numeric(14,2), lidos como string pelo driver,
 * para nunca usar ponto flutuante em dinheiro.
 * IDs vindos da Pluggy ficam em colunas `pluggy_*` com índice único,
 * para que a sincronização seja idempotente (upsert).
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/** Usuários autorizados (identificados pelo e-mail Google). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt,
});

/** Cada banco conectado via Pluggy (um "item"). */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pluggyItemId: text("pluggy_item_id").notNull(),
    connectorName: text("connector_name"),
    status: text("status").notNull(), // ex.: UPDATED, UPDATING, LOGIN_ERROR, WAITING_USER_INPUT
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex("connections_pluggy_item_id_uq").on(t.pluggyItemId), index("connections_user_idx").on(t.userId)],
);

/** Contas bancárias e cartões de crédito. */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    pluggyAccountId: text("pluggy_account_id").notNull(),
    type: text("type").notNull(), // BANK | CREDIT
    subtype: text("subtype"),
    name: text("name").notNull(),
    currencyCode: text("currency_code").notNull().default("BRL"),
    balance: money("balance").notNull(),
    creditLimit: money("credit_limit"),
    updatedAt,
  },
  (t) => [uniqueIndex("accounts_pluggy_account_id_uq").on(t.pluggyAccountId), index("accounts_connection_idx").on(t.connectionId)],
);

/** Categorias próprias (podem mapear categorias da Pluggy). */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pluggyCategoryId: text("pluggy_category_id"),
    isIncome: boolean("is_income").notNull().default(false),
    createdAt,
  },
  (t) => [uniqueIndex("categories_user_name_uq").on(t.userId, t.name)],
);

/** Movimentações. `amount` negativo = saída; positivo = entrada. */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    pluggyTransactionId: text("pluggy_transaction_id").notNull(),
    date: date("date").notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    currencyCode: text("currency_code").notNull().default("BRL"),
    pluggyCategory: text("pluggy_category"),
    // Categoria escolhida por você; tem prioridade sobre a da Pluggy.
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    status: text("status"), // POSTED | PENDING
    // Cartão de crédito (creditCardMetadata da Pluggy)
    purchaseDate: date("purchase_date"),
    installmentNumber: integer("installment_number"),
    totalInstallments: integer("total_installments"),
    pluggyBillId: text("pluggy_bill_id"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("transactions_pluggy_transaction_id_uq").on(t.pluggyTransactionId),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    index("transactions_category_idx").on(t.categoryId),
  ],
);

/** Posições de investimento. */
export const investments = pgTable(
  "investments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    pluggyInvestmentId: text("pluggy_investment_id").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    balance: money("balance").notNull(),
    currencyCode: text("currency_code").notNull().default("BRL"),
    updatedAt,
  },
  (t) => [uniqueIndex("investments_pluggy_investment_id_uq").on(t.pluggyInvestmentId)],
);

/** Faturas de cartão (só aparecem na Pluggy depois de fechadas; depende do banco). */
export const creditCardBills = pgTable(
  "credit_card_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    pluggyBillId: text("pluggy_bill_id").notNull(),
    dueDate: date("due_date").notNull(),
    closingDate: date("closing_date"),
    totalAmount: money("total_amount"),
    updatedAt,
  },
  (t) => [uniqueIndex("credit_card_bills_pluggy_bill_id_uq").on(t.pluggyBillId), index("credit_card_bills_account_idx").on(t.accountId)],
);

/**
 * Cadastro dos cartões: ciclo de fechamento/vencimento usado para saber em que
 * mês (competência) cada compra é paga. Ligado à conta CREDIT vinda da Pluggy.
 */
export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    bank: text("bank"),
    issuer: text("issuer"),
    closingDay: integer("closing_day").notNull(),
    dueDay: integer("due_day").notNull(),
    closingDayGoesTo: text("closing_day_goes_to").notNull().default("next"), // next | current
    installmentDateMode: text("installment_date_mode").notNull().default("purchase"), // purchase | posting
    rewards: text("rewards"),
    createdAt,
  },
  (t) => [index("cards_user_idx").on(t.userId), uniqueIndex("cards_account_uq").on(t.accountId)],
);

/** Contas fixas pagas fora do cartão. Meses no formato primeiro dia do mês. */
export const fixedExpenses = pgTable(
  "fixed_expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amount: money("amount").notNull(),
    dueDay: integer("due_day").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    startMonth: date("start_month"),
    endMonth: date("end_month"),
    createdAt,
  },
  (t) => [index("fixed_expenses_user_idx").on(t.userId)],
);

/**
 * Renda mensal. Vale a partir de `month` até o próximo registro;
 * `oneOff` = só naquele mês (13º, bônus).
 */
export const incomes = pgTable(
  "incomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    month: date("month").notNull(),
    amount: money("amount").notNull(),
    oneOff: boolean("one_off").notNull().default(false),
    createdAt,
  },
  (t) => [uniqueIndex("incomes_user_month_oneoff_uq").on(t.userId, t.month, t.oneOff)],
);

/** Regras de categorização: trecho da descrição ou categoria da Pluggy -> sua categoria. */
export const categoryRules = pgTable(
  "category_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    matchType: text("match_type").notNull(), // description | pluggy_category
    pattern: text("pattern").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    createdAt,
  },
  (t) => [index("category_rules_user_idx").on(t.userId)],
);

/**
 * Limite mensal por categoria. `month` = primeiro dia do mês.
 * Vale a partir desse mês até o próximo registro da mesma categoria.
 */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    month: date("month").notNull(),
    limitAmount: money("limit_amount").notNull(),
    alertAtPercent: integer("alert_at_percent").notNull().default(80),
    createdAt,
  },
  (t) => [uniqueIndex("budgets_user_category_month_uq").on(t.userId, t.categoryId, t.month)],
);

/**
 * Webhooks recebidos da Pluggy. `event_id` único garante que um aviso
 * repetido não seja processado duas vezes. O payload é guardado só
 * para diagnóstico: os dados reais são sempre buscados de novo na API.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id").notNull(),
    event: text("event").notNull(),
    itemId: text("item_id"),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [uniqueIndex("webhook_events_event_id_uq").on(t.eventId)],
);

/** Trilha de auditoria de ações sensíveis (conectar/remover banco, exportar, etc.). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    details: jsonb("details"),
    createdAt,
  },
  (t) => [index("audit_log_user_created_idx").on(t.userId, t.createdAt)],
);
