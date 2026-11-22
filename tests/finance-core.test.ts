import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CardRules,
  addDays,
  activeInstallments,
  billsByCard,
  dailySpend,
  type CardTransaction,
  cardEntries,
  cardsToday,
  cycleProgress,
  dueDateInMonth,
  categorize,
  centsToMoney,
  dueForPurchase,
  fixedEntries,
  monthSummary,
  outlook,
  parseCents,
  parseUserAmount,
  projectInstallments,
  purchasesBetween,
  resolveInversion,
  valueForMonth,
} from "../src/lib/finance/core.ts";

const A: CardRules = { id: "a", name: "Cartão A", closingDay: 25, dueDay: 5, closingDayGoesTo: "next", installmentDateMode: "purchase" };
const B: CardRules = { id: "b", name: "Cartão B", closingDay: 3, dueDay: 10, closingDayGoesTo: "next", installmentDateMode: "posting" };
const cards = new Map([
  ["a", A],
  ["b", B],
]);

function tx(p: Partial<CardTransaction> & { id: string; date: string; amountCents: number }): CardTransaction {
  return { cardId: "a", purchaseDate: null, description: "COMPRA", installmentNumber: null, totalInstallments: null, billDueDate: null, category: "Outros", ...p };
}

describe("dinheiro", () => {
  it("converte sem ponto flutuante", () => {
    assert.equal(parseCents("-1234.5"), -123450);
    assert.equal(parseCents("0.10"), 10);
    assert.equal(parseCents("89.90"), 8990);
    assert.equal(centsToMoney(-123450), "-1234.50");
    assert.equal(centsToMoney(5), "0.05");
    assert.throws(() => parseCents("abc"));
  });
  it("lê valores digitados no formato brasileiro", () => {
    assert.equal(parseUserAmount("1.234,56"), 123456);
    assert.equal(parseUserAmount("R$ 3.500"), 350000);
    assert.equal(parseUserAmount("89,9"), 8990);
    assert.equal(parseUserAmount("1234.56"), 123456);
    assert.equal(parseUserAmount("-10"), null);
    assert.equal(parseUserAmount("abc"), null);
  });
  it("soma dias atravessando meses", () => {
    assert.equal(addDays("2026-11-22", -6), "2026-11-16");
    assert.equal(addDays("2026-03-02", -3), "2026-02-27");
  });
});

describe("ciclo da fatura", () => {
  it("fecha 25, vence 5", () => {
    assert.equal(dueForPurchase("2026-11-22", A), "2026-12-05");
    assert.equal(dueForPurchase("2026-11-25", A), "2027-01-05"); // dia do fechamento -> próxima
    assert.equal(dueForPurchase("2026-11-25", { ...A, closingDayGoesTo: "current" }), "2026-12-05");
  });
  it("fecha 3, vence 10", () => {
    assert.equal(dueForPurchase("2026-11-02", B), "2026-11-10");
    assert.equal(dueForPurchase("2026-11-04", B), "2026-12-10");
  });
  it("dia 31 em fevereiro", () => {
    const c = { ...A, closingDay: 31, dueDay: 8 };
    assert.equal(dueForPurchase("2027-02-27", c), "2027-03-08");
    assert.equal(dueForPurchase("2027-02-28", c), "2027-04-08");
  });
  it("prazo e ordem dos cartões hoje", () => {
    const r = cardsToday([A, B], [], "2026-11-22");
    assert.deepEqual(
      r.map((c) => [c.cardId, c.daysOfCredit, c.daysUntilClosing]),
      [
        ["b", 18, 11],
        ["a", 13, 3],
      ],
    );
  });
});

describe("lançamentos e parcelas", () => {
  it("parcela com purchaseDate projeta as restantes", () => {
    const e = cardEntries([tx({ id: "t1", date: "2026-10-10", purchaseDate: "2026-10-10", amountCents: -10000, installmentNumber: 1, totalInstallments: 3 })], cards);
    assert.equal(e[0].month, "2026-11");
    assert.deepEqual(
      projectInstallments(e).map((p) => [p.installment, p.month]),
      [
        [2, "2026-12"],
        [3, "2027-01"],
      ],
    );
  });
  it("parcela 2 com a data original cai um mês depois", () => {
    const e = cardEntries([tx({ id: "t2", date: "2026-10-10", amountCents: -10000, installmentNumber: 2, totalInstallments: 3 })], cards);
    assert.equal(e[0].month, "2026-12");
  });
  it("modo 'posting' não duplica projeções", () => {
    const e = cardEntries(
      [
        tx({ id: "t3", cardId: "b", date: "2026-10-10", amountCents: -5000, description: "CURSO 01/03", installmentNumber: 1, totalInstallments: 3 }),
        tx({ id: "t4", cardId: "b", date: "2026-11-10", amountCents: -5000, description: "CURSO 02/03", installmentNumber: 2, totalInstallments: 3 }),
      ],
      cards,
    );
    assert.deepEqual(
      e.map((x) => x.month),
      ["2026-11", "2026-12"],
    );
    assert.deepEqual(
      projectInstallments(e).map((p) => [p.installment, p.month]),
      [[3, "2027-01"]],
    );
  });
  it("vencimento da fatura tem prioridade", () => {
    const e = cardEntries([tx({ id: "t5", date: "2026-11-01", amountCents: -8000, billDueDate: "2027-02-05" })], cards);
    assert.equal(e[0].month, "2027-02");
  });
  it("ignora pagamento de fatura e trata estorno", () => {
    const e = cardEntries(
      [
        tx({ id: "p", date: "2026-11-20", amountCents: 500000, description: "PAGAMENTO RECEBIDO" }),
        tx({ id: "c", date: "2026-11-20", amountCents: -20000 }),
        tx({ id: "r", date: "2026-11-21", amountCents: 5000, description: "ESTORNO" }),
      ],
      cards,
    );
    assert.deepEqual(e.map((x) => x.cents).sort((a, b) => a - b), [-5000, 20000]);
  });
  it("cartão sem cadastro é ignorado", () => {
    assert.equal(cardEntries([tx({ id: "z", cardId: "x", date: "2026-11-01", amountCents: -100 })], cards).length, 0);
  });
});

describe("categorias e valores mensais", () => {
  const rules = [
    { matchType: "description" as const, pattern: "ifood", category: "Restaurantes" },
    { matchType: "pluggy_category" as const, pattern: "Shopping", category: "Compras" },
  ];
  it("prioridade: manual > descrição > categoria Pluggy > própria Pluggy", () => {
    assert.equal(categorize("IFOOD *X", "Shopping", rules, "Lazer"), "Lazer");
    assert.equal(categorize("IFOOD *X", "Shopping", rules, null), "Restaurantes");
    assert.equal(categorize("LOJA", "shopping", rules, null), "Compras");
    assert.equal(categorize("LOJA", null, rules, null), "Outros");
  });
  it("valor vigente com exceção pontual", () => {
    const v = [
      { month: "2026-01", cents: 1000000 },
      { month: "2026-12", cents: 2200000, oneOff: true },
      { month: "2027-03", cents: 1200000 },
    ];
    assert.equal(valueForMonth(v, "2025-12"), 0);
    assert.equal(valueForMonth(v, "2026-11"), 1000000);
    assert.equal(valueForMonth(v, "2026-12"), 2200000);
    assert.equal(valueForMonth(v, "2027-01"), 1000000);
    assert.equal(valueForMonth(v, "2027-04"), 1200000);
  });
});

describe("resumo do mês e comprometimento", () => {
  const txs = [
    tx({ id: "t9", date: "2026-11-20", amountCents: -60000, category: "Restaurantes" }),
    tx({ id: "t10", date: "2026-09-10", purchaseDate: "2026-09-10", amountCents: -10000, installmentNumber: 1, totalInstallments: 4, category: "Compras" }),
  ];
  const real = cardEntries(txs, cards);
  const fixed = fixedEntries([{ id: "f", name: "Aluguel", cents: 300000, dueDay: 5, category: "Moradia", startMonth: null, endMonth: "2027-01" }], ["2026-12", "2027-01", "2027-02"]);
  const all = [...real, ...projectInstallments(real), ...fixed];

  it("separa parcelas antigas de compras novas", () => {
    const r = monthSummary(all, "2026-12", 1000000, new Map([["Restaurantes", 50000], ["Moradia", 300000]]));
    assert.equal(r.fixedCents, 300000);
    assert.equal(r.pastInstallmentsCents, 10000); // parcela 3/4 projetada
    assert.equal(r.newPurchasesCents, 60000);
    assert.equal(r.leftoverCents, 1000000 - 370000);
    assert.equal(r.categories.find((c) => c.category === "Restaurantes")?.usePercent, 120);
    assert.deepEqual(r.byCard, [{ cardId: "a", postedCents: 60000, projectedCents: 10000 }]);
  });
  it("comprometimento futuro", () => {
    const o = outlook(all, "2026-12", 3, () => 1000000);
    assert.deepEqual(
      o.map((x) => [x.month, x.fixedCents, x.installmentsCents, x.singlePurchasesCents]),
      [
        ["2026-12", 300000, 10000, 60000],
        ["2027-01", 300000, 10000, 0],
        ["2027-02", 0, 0, 0],
      ],
    );
  });
  it("compras do período", () => {
    assert.deepEqual(
      purchasesBetween(all, "2026-11-16", "2026-11-22").map((e) => e.id),
      ["t9"],
    );
  });
});

describe("séries do painel", () => {
  const real = cardEntries(
    [
      tx({ id: "a1", date: "2026-11-20", amountCents: -10000 }),
      tx({ id: "b1", cardId: "b", date: "2026-11-05", amountCents: -4000 }),
      tx({ id: "p1", date: "2026-10-10", purchaseDate: "2026-10-10", amountCents: -3000, description: "LOJA 01/03", installmentNumber: 1, totalInstallments: 3 }),
    ],
    cards,
  );
  const all = [...real, ...projectInstallments(real)];

  it("fatura por cartão e mês", () => {
    const b = billsByCard(all, "2026-11", 3);
    assert.deepEqual(
      b.map((m) => [m.month, m.totalCents]),
      [
        ["2026-11", 3000],
        ["2026-12", 17000],
        ["2027-01", 3000],
      ],
    );
    assert.deepEqual(b[1].byCard.get("a"), { postedCents: 10000, projectedCents: 3000 });
    assert.deepEqual(b[1].byCard.get("b"), { postedCents: 4000, projectedCents: 0 });
  });

  it("gasto por dia preenche dias vazios", () => {
    const d = dailySpend(all, "2026-11-19", "2026-11-21");
    assert.deepEqual(
      d.map((x) => x.cents),
      [0, 10000, 0],
    );
  });

  it("parcelas ativas a partir de um mês", () => {
    const a = activeInstallments(all, "2026-12");
    assert.equal(a.length, 1);
    assert.equal(a[0].currentInstallment, 2);
    assert.equal(a[0].remainingAfter, 1);
    assert.equal(a[0].remainingCents, 3000);
    assert.equal(a[0].lastMonth, "2027-01");
    assert.equal(activeInstallments(all, "2027-02").length, 0);
  });
});

describe("ciclo aberto", () => {
  it("progresso entre fechamentos", () => {
    assert.deepEqual(cycleProgress("2026-11-22", A), { start: "2026-10-26", end: "2026-11-25", elapsedDays: 28, totalDays: 31 });
    assert.deepEqual(cycleProgress("2026-11-25", A), { start: "2026-11-26", end: "2026-12-25", elapsedDays: 0, totalDays: 30 });
  });
  it("vencimento na competência", () => {
    assert.equal(dueDateInMonth("2027-02", { ...A, dueDay: 30 }), "2027-02-28");
  });
});

describe("sinal do cartão", () => {
  it("detecta compras invertidas pela maioria", () => {
    assert.equal(resolveInversion("auto", 40, 3), true);
    assert.equal(resolveInversion("auto", 2, 50), false);
    assert.equal(resolveInversion("auto", 0, 0), false);
    assert.equal(resolveInversion("normal", 40, 3), false);
    assert.equal(resolveInversion("inverted", 0, 9), true);
  });
  it("cartão invertido: compras viram gasto e pagamento continua ignorado", () => {
    const inverted = [
      tx({ id: "c", date: "2026-11-20", amountCents: 20000 }),
      tx({ id: "r", date: "2026-11-21", amountCents: -5000, description: "ESTORNO" }),
      tx({ id: "p", date: "2026-11-10", amountCents: -500000, description: "PAGAMENTO RECEBIDO" }),
    ].map((t) => ({ ...t, amountCents: -t.amountCents }));
    const e = cardEntries(inverted, cards);
    assert.deepEqual(e.map((x) => [x.id, x.cents]), [["c", 20000], ["r", -5000]]);
  });
});
