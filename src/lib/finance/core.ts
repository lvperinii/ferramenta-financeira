/**
 * Regras de orçamento por fatura de cartão. Módulo PURO: sem banco, sem rede,
 * sem imports — testado com `node --test` (tests/finance-core.test.ts).
 *
 * Conceito central: a COMPETÊNCIA de um gasto é o mês em que a fatura que o
 * contém VENCE (o mês em que o dinheiro sai). Compra em 22/11 num cartão que
 * fecha dia 25 e vence dia 5 entra na fatura de 05/12 -> competência "2026-12".
 *
 * Dinheiro: sempre em CENTAVOS inteiros (`number` inteiro, nunca fração),
 * convertido de/para as strings `numeric(14,2)` do banco por parseCents/centsToMoney.
 * Datas: strings "AAAA-MM-DD"; competências: "AAAA-MM".
 */

// ---------------------------------------------------------------- Dinheiro

/** "-1234.5" -> -123450. Faz a conversão por texto, sem ponto flutuante. */
export function parseCents(value: string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const match = /^\s*(-)?(\d+)(?:\.(\d{1,2})\d*)?\s*$/.exec(value);
  if (!match) throw new Error(`Valor monetário inválido: ${value}`);
  const [, minus, int, frac = ""] = match;
  const cents = Number(int) * 100 + Number(frac.padEnd(2, "0"));
  return minus ? -cents : cents;
}

/**
 * Valor digitado por você: "1.234,56", "1234,56", "1234.56" ou "1234" -> centavos.
 * Retorna null se não for um valor válido (>= 0, até 2 casas).
 */
export function parseUserAmount(input: string): number | null {
  let s = input.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return parseCents(s);
}

/** 123450 -> "1234.50" */
export function centsToMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Centavos devem ser inteiros");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- Datas

function pad(n: number, size = 2): string {
  return String(n).padStart(size, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

type YMD = { y: number; m: number; d: number };

function parseDate(s: string): YMD {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function fmtDate({ y, m, d }: YMD): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Data com o dia limitado ao fim do mês (dia 31 em fevereiro -> 28/29). */
function clampDay(y: number, m: number, d: number): YMD {
  return { y, m, d: Math.min(d, daysInMonth(y, m)) };
}

function addMonthsYM(y: number, m: number, n: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + n;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const r = addMonthsYM(y, m, n);
  return `${pad(r.y, 4)}-${pad(r.m)}`;
}

/** "2026-11-22" + (-6) -> "2026-11-16" */
export function addDays(date: string, n: number): string {
  const p = parseDate(date);
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10);
}

/** Dias entre duas datas "AAAA-MM-DD" (b - a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

function cmp(a: YMD, b: YMD): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

// ---------------------------------------------------------------- Ciclo do cartão

export type CardRules = {
  id: string;
  name: string;
  closingDay: number; // 1..31
  dueDay: number; // 1..31
  /** Compra feita NO dia do fechamento: "next" (padrão, mais comum) ou "current". */
  closingDayGoesTo: "next" | "current";
  /**
   * Quando a Pluggy não informa purchaseDate nem a fatura:
   * "purchase" = a data da parcela k/n é a data da compra original (desloca k-1 meses);
   * "posting"  = a data já é a do mês em que a parcela foi lançada.
   */
  installmentDateMode: "purchase" | "posting";
  rewards?: string | null;
};

/** Fechamento da fatura em que entra uma compra feita em `date`. */
export function closingForPurchase(date: string, card: CardRules): string {
  const p = parseDate(date);
  const closing = clampDay(p.y, p.m, card.closingDay);
  const c = cmp(p, closing);
  if (c < 0 || (c === 0 && card.closingDayGoesTo === "current")) return fmtDate(closing);
  const next = addMonthsYM(p.y, p.m, 1);
  return fmtDate(clampDay(next.y, next.m, card.closingDay));
}

/** Vencimento de um fechamento: mesmo mês se o dia de vencimento for maior; senão, mês seguinte. */
export function dueForClosing(closing: string, card: CardRules): string {
  const c = parseDate(closing);
  if (card.dueDay > card.closingDay) return fmtDate(clampDay(c.y, c.m, card.dueDay));
  const next = addMonthsYM(c.y, c.m, 1);
  return fmtDate(clampDay(next.y, next.m, card.dueDay));
}

export function dueForPurchase(date: string, card: CardRules): string {
  return dueForClosing(closingForPurchase(date, card), card);
}

export type CardToday = {
  cardId: string;
  name: string;
  rewards: string | null;
  closesOn: string;
  dueOn: string;
  month: string;
  daysUntilClosing: number;
  /** Dias entre uma compra feita hoje e o pagamento dela. */
  daysOfCredit: number;
  openBillCents: number;
};

// ---------------------------------------------------------------- Lançamentos

export type CardTransaction = {
  id: string;
  cardId: string;
  /** Data informada pela Pluggy. */
  date: string;
  /** creditCardMetadata.purchaseDate, quando houver. */
  purchaseDate: string | null;
  description: string;
  /** Com sinal, como no banco: negativo = gasto; positivo = estorno/crédito. */
  amountCents: number;
  installmentNumber: number | null;
  totalInstallments: number | null;
  /** Vencimento da fatura vinculada (creditCardMetadata.billId -> bills.dueDate), se conhecida. */
  billDueDate: string | null;
  category: string;
};

export type Entry = {
  id: string;
  origin: "card" | "projected" | "fixed";
  cardId: string | null;
  /** Data da compra (ou do vencimento, para contas fixas). */
  date: string;
  /** Competência: mês em que é pago. */
  month: string;
  description: string;
  category: string;
  /** Positivo = saída; negativo = estorno. */
  cents: number;
  installment: number | null;
  totalInstallments: number | null;
  /** Data que identifica a compra original (igual em todas as parcelas), se conhecida. */
  originDate: string | null;
};

/** Pagamentos de fatura aparecem como crédito no cartão e não são gasto nem estorno. */
export const BILL_PAYMENT_PATTERNS = ["PAGAMENTO RECEBIDO", "PAGAMENTO DE FATURA", "PAGTO FATURA", "PAGAMENTO EFETUADO", "PAGAMENTO FATURA"];

export function isBillPayment(description: string): boolean {
  const d = description.toUpperCase();
  return BILL_PAYMENT_PATTERNS.some((p) => d.includes(p));
}

export function cardEntries(txs: CardTransaction[], cards: Map<string, CardRules>): Entry[] {
  const out: Entry[] = [];
  for (const t of txs) {
    const card = cards.get(t.cardId);
    if (!card) continue;
    if (t.amountCents > 0 && isBillPayment(t.description)) continue;
    const n = t.totalInstallments ?? 0;
    const k = n > 1 && t.installmentNumber ? t.installmentNumber : null;

    let month: string;
    if (t.billDueDate) {
      month = monthOf(t.billDueDate);
    } else {
      const usePurchase = t.purchaseDate !== null || card.installmentDateMode === "purchase";
      const base = t.purchaseDate ?? t.date;
      const shift = usePurchase && k ? k - 1 : 0;
      month = addMonths(monthOf(dueForPurchase(base, card)), shift);
    }

    out.push({
      id: t.id,
      origin: "card",
      cardId: card.id,
      date: t.purchaseDate ?? t.date,
      month,
      description: t.description,
      category: t.category,
      cents: -t.amountCents,
      installment: k,
      totalInstallments: k ? n : null,
      originDate: t.purchaseDate ?? (card.installmentDateMode === "purchase" ? t.date : null),
    });
  }
  return out;
}

function baseDescription(d: string): string {
  return d
    .toUpperCase()
    .replace(/\b(PARC(ELA)?\.?|\d{1,2}\s*\/\s*\d{1,2}|\d+)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A API só traz parcelas já lançadas; aqui projetamos as que faltam. */
export function projectInstallments(entries: Entry[]): Entry[] {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.origin !== "card" || !e.installment || !e.totalInstallments || e.cents <= 0) continue;
    const key = [e.cardId, e.totalInstallments, Math.round(e.cents / 100), e.originDate ?? "", baseDescription(e.description)].join("|");
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const out: Entry[] = [];
  for (const list of groups.values()) {
    const kmax = Math.max(...list.map((e) => e.installment ?? 0));
    for (const last of list.filter((e) => e.installment === kmax)) {
      for (let j = kmax + 1; j <= (last.totalInstallments ?? 0); j++) {
        out.push({ ...last, id: `${last.id}#p${j}`, origin: "projected", month: addMonths(last.month, j - kmax), installment: j });
      }
    }
  }
  return out;
}

export type FixedExpense = {
  id: string;
  name: string;
  cents: number;
  dueDay: number;
  category: string;
  startMonth: string | null; // "AAAA-MM"
  endMonth: string | null;
};

export function fixedEntries(items: FixedExpense[], months: string[]): Entry[] {
  const out: Entry[] = [];
  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    for (const f of items) {
      if (f.startMonth && month < f.startMonth) continue;
      if (f.endMonth && month > f.endMonth) continue;
      out.push({
        id: `fixed:${f.id}:${month}`,
        origin: "fixed",
        cardId: null,
        date: fmtDate(clampDay(y, m, f.dueDay)),
        month,
        description: f.name,
        category: f.category,
        cents: f.cents,
        installment: null,
        totalInstallments: null,
        originDate: null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Categorias

export type CategoryRule = { matchType: "description" | "pluggy_category"; pattern: string; category: string };

export function categorize(
  description: string,
  pluggyCategory: string | null,
  rules: CategoryRule[],
  manual: string | null,
  fallback = "Outros",
): string {
  if (manual) return manual;
  const desc = description.toUpperCase();
  for (const r of rules) {
    if (r.matchType === "description" && r.pattern && desc.includes(r.pattern.toUpperCase())) return r.category;
  }
  for (const r of rules) {
    if (r.matchType === "pluggy_category" && pluggyCategory && r.pattern.toLowerCase() === pluggyCategory.toLowerCase()) return r.category;
  }
  return pluggyCategory ?? fallback;
}

// ---------------------------------------------------------------- Valores por mês

/** Valor vigente num mês: o registro exato com `oneOff`, senão o mais recente com mês <= alvo. */
export type MonthlyValue = { month: string; cents: number; oneOff?: boolean };

export function valueForMonth(values: MonthlyValue[], month: string): number {
  const exact = values.find((v) => v.oneOff && v.month === month);
  if (exact) return exact.cents;
  let best: MonthlyValue | null = null;
  for (const v of values) {
    if (v.oneOff || v.month > month) continue;
    if (!best || v.month > best.month) best = v;
  }
  return best?.cents ?? 0;
}

// ---------------------------------------------------------------- Relatórios

export type CategoryLine = {
  category: string;
  budgetCents: number;
  newCents: number;
  pastInstallmentsCents: number;
  fixedCents: number;
  totalCents: number;
  availableCents: number;
  usePercent: number | null;
};

export type MonthSummary = {
  month: string;
  incomeCents: number;
  fixedCents: number;
  cardsCents: number;
  pastInstallmentsCents: number;
  newPurchasesCents: number;
  totalCents: number;
  leftoverCents: number;
  budgetTotalCents: number;
  categories: CategoryLine[];
  byCard: { cardId: string; postedCents: number; projectedCents: number }[];
};

const isPastInstallment = (e: Entry) => e.origin !== "fixed" && (e.installment ?? 0) > 1;

export function monthSummary(entries: Entry[], month: string, incomeCents: number, budgets: Map<string, number>): MonthSummary {
  const inMonth = entries.filter((e) => e.month === month);
  const cats = new Map<string, { newCents: number; pastInstallmentsCents: number; fixedCents: number }>();
  const cards = new Map<string, { postedCents: number; projectedCents: number }>();
  for (const e of inMonth) {
    const c = cats.get(e.category) ?? { newCents: 0, pastInstallmentsCents: 0, fixedCents: 0 };
    if (e.origin === "fixed") c.fixedCents += e.cents;
    else if (isPastInstallment(e)) c.pastInstallmentsCents += e.cents;
    else c.newCents += e.cents;
    cats.set(e.category, c);
    if (e.cardId) {
      const k = cards.get(e.cardId) ?? { postedCents: 0, projectedCents: 0 };
      if (e.origin === "projected") k.projectedCents += e.cents;
      else k.postedCents += e.cents;
      cards.set(e.cardId, k);
    }
  }
  const names = new Set([...budgets.keys(), ...cats.keys()]);
  const categories: CategoryLine[] = [...names].map((category) => {
    const c = cats.get(category) ?? { newCents: 0, pastInstallmentsCents: 0, fixedCents: 0 };
    const totalCents = c.newCents + c.pastInstallmentsCents + c.fixedCents;
    const budgetCents = budgets.get(category) ?? 0;
    return {
      category,
      budgetCents,
      ...c,
      totalCents,
      availableCents: budgetCents - totalCents,
      usePercent: budgetCents > 0 ? Math.round((1000 * totalCents) / budgetCents) / 10 : null,
    };
  });
  categories.sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category));

  const fixedCents = sum(inMonth.filter((e) => e.origin === "fixed"));
  const cardsCents = sum(inMonth.filter((e) => e.origin !== "fixed"));
  const pastInstallmentsCents = sum(inMonth.filter(isPastInstallment));
  const totalCents = fixedCents + cardsCents;
  return {
    month,
    incomeCents,
    fixedCents,
    cardsCents,
    pastInstallmentsCents,
    newPurchasesCents: cardsCents - pastInstallmentsCents,
    totalCents,
    leftoverCents: incomeCents - totalCents,
    budgetTotalCents: [...budgets.values()].reduce((a, b) => a + b, 0),
    categories,
    byCard: [...cards.entries()].map(([cardId, v]) => ({ cardId, ...v })),
  };
}

function sum(list: Entry[]): number {
  return list.reduce((a, e) => a + e.cents, 0);
}

export type OutlookMonth = {
  month: string;
  incomeCents: number;
  fixedCents: number;
  installmentsCents: number;
  singlePurchasesCents: number;
  committedCents: number;
  committedPercent: number | null;
  freeCents: number;
};

/** Quanto de cada mês futuro JÁ está comprometido (fixas + parcelas + compras já feitas). */
export function outlook(entries: Entry[], start: string, months: number, incomeFor: (month: string) => number): OutlookMonth[] {
  const out: OutlookMonth[] = [];
  for (let i = 0; i < months; i++) {
    const month = addMonths(start, i);
    const inMonth = entries.filter((e) => e.month === month);
    const fixedCents = sum(inMonth.filter((e) => e.origin === "fixed"));
    const installmentsCents = sum(inMonth.filter((e) => e.origin !== "fixed" && e.installment));
    const singlePurchasesCents = sum(inMonth.filter((e) => e.origin !== "fixed" && !e.installment));
    const committedCents = fixedCents + installmentsCents + singlePurchasesCents;
    const incomeCents = incomeFor(month);
    out.push({
      month,
      incomeCents,
      fixedCents,
      installmentsCents,
      singlePurchasesCents,
      committedCents,
      committedPercent: incomeCents > 0 ? Math.round((1000 * committedCents) / incomeCents) / 10 : null,
      freeCents: incomeCents - committedCents,
    });
  }
  return out;
}

/** Compras feitas entre duas datas (inclusive), sem parcelas antigas nem projeções. */
export function purchasesBetween(entries: Entry[], from: string, to: string): Entry[] {
  return entries
    .filter((e) => e.origin === "card" && !isPastInstallment(e) && e.date >= from && e.date <= to)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Situação de cada cartão hoje, do que dá MAIS prazo para o que dá menos. */
export function cardsToday(cards: CardRules[], entries: Entry[], today: string): CardToday[] {
  return cards
    .map((card) => {
      const closesOn = closingForPurchase(today, card);
      const dueOn = dueForClosing(closesOn, card);
      const month = monthOf(dueOn);
      return {
        cardId: card.id,
        name: card.name,
        rewards: card.rewards ?? null,
        closesOn,
        dueOn,
        month,
        daysUntilClosing: daysBetween(today, closesOn),
        daysOfCredit: daysBetween(today, dueOn),
        openBillCents: sum(entries.filter((e) => e.cardId === card.id && e.month === month)),
      };
    })
    .sort((a, b) => b.daysOfCredit - a.daysOfCredit);
}
