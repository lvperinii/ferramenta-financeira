"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { accounts, budgets, cards, categories, categoryRules, connections, fixedExpenses, incomes } from "@/db/schema";
import { centsToMoney, parseUserAmount } from "@/lib/finance/core";
import { getSessionEmail } from "@/lib/session";
import { getOrCreateUserId } from "@/lib/users";

/*
 * Server Actions são endpoints públicos: toda ação confere a sessão e
 * toda escrita/remoção filtra pelo usuário logado.
 */

async function requireUserId(): Promise<string> {
  const email = await getSessionEmail();
  if (!email) throw new Error("Não autenticado");
  return getOrCreateUserId(email);
}

function fail(message: string): never {
  redirect(`/configuracoes?erro=${encodeURIComponent(message)}`);
}

const text = (max = 80) => z.string().trim().min(1).max(max);
const optionalText = (max = 80) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));
const day = z.coerce.number().int().min(1).max(31);
const monthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM");
const optionalMonth = z.union([z.literal(""), monthInput]).transform((v) => (v === "" ? null : `${v}-01`));
const amount = z.string().transform((v, ctx) => {
  const cents = parseUserAmount(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Valor inválido (use, por exemplo, 1.234,56)" });
    return z.NEVER;
  }
  return centsToMoney(cents);
});

function parse<T extends z.ZodType>(schema: T, formData: FormData): z.infer<T> {
  const r = schema.safeParse(Object.fromEntries(formData));
  if (!r.success) fail(r.error.issues[0]?.message ?? "Dados inválidos.");
  return r.data;
}

async function categoryId(userId: string, name: string): Promise<string> {
  const db = getDb();
  const [inserted] = await db
    .insert(categories)
    .values({ userId, name })
    .onConflictDoNothing({ target: [categories.userId, categories.name] })
    .returning({ id: categories.id });
  if (inserted) return inserted.id;
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, name)))
    .limit(1);
  if (!existing) throw new Error("Categoria não encontrada");
  return existing.id;
}

const uuid = () => z.uuid("Registro inválido.");
const idOnly = z.object({ id: uuid() });

// ---------------------------------------------------------------- Cartões

const cardSchema = z.object({
  id: z.union([z.literal(""), uuid()]),
  accountId: z.union([z.literal(""), uuid()]),
  name: text(),
  bank: optionalText(),
  issuer: optionalText(),
  closingDay: day,
  dueDay: day,
  closingDayGoesTo: z.enum(["next", "current"]),
  installmentDateMode: z.enum(["purchase", "posting"]),
  signMode: z.enum(["auto", "normal", "inverted"]),
  rewards: optionalText(120),
});

export async function salvarCartao(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const v = parse(cardSchema, formData);
  const db = getDb();

  let accountId: string | null = null;
  if (v.accountId) {
    // A conta precisa ser um cartão de uma conexão sua.
    const [own] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .where(and(eq(accounts.id, v.accountId), eq(connections.userId, userId), eq(accounts.type, "CREDIT")))
      .limit(1);
    if (!own) fail("Conta de cartão não encontrada.");
    accountId = own.id;
  }

  const values = {
    userId,
    accountId,
    name: v.name,
    bank: v.bank,
    issuer: v.issuer,
    closingDay: v.closingDay,
    dueDay: v.dueDay,
    closingDayGoesTo: v.closingDayGoesTo,
    installmentDateMode: v.installmentDateMode,
    signMode: v.signMode,
    rewards: v.rewards,
  };
  try {
    if (v.id) {
      await db.update(cards).set(values).where(and(eq(cards.id, v.id), eq(cards.userId, userId)));
    } else {
      await db.insert(cards).values(values);
    }
  } catch {
    fail("Essa conta da Pluggy já está ligada a outro cartão.");
  }
  refresh();
}

export async function removerCartao(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const { id } = parse(idOnly, formData);
  await getDb().delete(cards).where(and(eq(cards.id, id), eq(cards.userId, userId)));
  refresh();
}

// ---------------------------------------------------------------- Contas fixas

const fixedSchema = z.object({
  name: text(),
  amount,
  dueDay: day,
  category: text(),
  startMonth: optionalMonth,
  endMonth: optionalMonth,
});

export async function salvarContaFixa(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const v = parse(fixedSchema, formData);
  if (v.startMonth && v.endMonth && v.endMonth < v.startMonth) fail("O mês final é anterior ao inicial.");
  await getDb()
    .insert(fixedExpenses)
    .values({
      userId,
      name: v.name,
      amount: v.amount,
      dueDay: v.dueDay,
      categoryId: await categoryId(userId, v.category),
      startMonth: v.startMonth,
      endMonth: v.endMonth,
    });
  refresh();
}

export async function removerContaFixa(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const { id } = parse(idOnly, formData);
  await getDb().delete(fixedExpenses).where(and(eq(fixedExpenses.id, id), eq(fixedExpenses.userId, userId)));
  refresh();
}

// ---------------------------------------------------------------- Renda

const incomeSchema = z.object({ month: monthInput, amount, oneOff: z.literal("on").optional() });

export async function salvarRenda(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const v = parse(incomeSchema, formData);
  const oneOff = v.oneOff === "on";
  await getDb()
    .insert(incomes)
    .values({ userId, month: `${v.month}-01`, amount: v.amount, oneOff })
    .onConflictDoUpdate({ target: [incomes.userId, incomes.month, incomes.oneOff], set: { amount: v.amount } });
  refresh();
}

export async function removerRenda(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const { id } = parse(idOnly, formData);
  await getDb().delete(incomes).where(and(eq(incomes.id, id), eq(incomes.userId, userId)));
  refresh();
}

// ---------------------------------------------------------------- Orçamento

const budgetSchema = z.object({ category: text(), amount, month: monthInput });

export async function salvarOrcamento(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const v = parse(budgetSchema, formData);
  const catId = await categoryId(userId, v.category);
  await getDb()
    .insert(budgets)
    .values({ userId, categoryId: catId, month: `${v.month}-01`, limitAmount: v.amount })
    .onConflictDoUpdate({ target: [budgets.userId, budgets.categoryId, budgets.month], set: { limitAmount: v.amount } });
  refresh();
}

export async function removerOrcamento(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const { id } = parse(idOnly, formData);
  await getDb().delete(budgets).where(and(eq(budgets.id, id), eq(budgets.userId, userId)));
  refresh();
}

// ---------------------------------------------------------------- Regras de categoria

const ruleSchema = z.object({ matchType: z.enum(["description", "pluggy_category"]), pattern: text(), category: text() });

export async function salvarRegra(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const v = parse(ruleSchema, formData);
  await getDb()
    .insert(categoryRules)
    .values({ userId, matchType: v.matchType, pattern: v.pattern, categoryId: await categoryId(userId, v.category) });
  refresh();
}

export async function removerRegra(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const { id } = parse(idOnly, formData);
  await getDb().delete(categoryRules).where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)));
  refresh();
}
