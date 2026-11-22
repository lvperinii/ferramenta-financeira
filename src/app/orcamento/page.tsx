import { type ReactNode, Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import {
  type CardRules,
  activeInstallments,
  addDays,
  addMonths,
  billsByCard,
  cardsToday,
  cycleProgress,
  dailySpend,
  dueDateInMonth,
  monthOf,
  monthSummary,
  outlook,
  purchasesBetween,
} from "@/lib/finance/core";
import { brlCents, dayLabel, monthLabel, monthShortLabel, percentLabel } from "@/lib/finance/format";
import { type FinanceData, loadFinance } from "@/lib/finance/load";
import { getSessionEmail } from "@/lib/session";
import { getOrCreateUserId } from "@/lib/users";
import { Nav } from "../components/Nav";
import { Legend, type Series, StackedColumns } from "./components/StackedColumns";
import { TooltipLayer } from "./components/TooltipLayer";
import s from "./dashboard.module.css";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const SLOTS = 6;
const NEUTRAL = "var(--neutral)";

/** A cor acompanha o cartão (ordem de cadastro), nunca a posição num ranking. */
function cardColor(data: FinanceData, cardId: string | null): string {
  const slot = cardId ? data.cardInfo.get(cardId)?.colorSlot : undefined;
  return slot !== undefined && slot < SLOTS ? `var(--s${slot + 1})` : NEUTRAL;
}

function usageTone(p: number | null): "good" | "warn" | "bad" {
  if (p === null || p < 80) return "good";
  return p > 100 ? "bad" : "warn";
}

function Swatch({ color }: { color: string }) {
  return <span className={s.swatch} style={{ background: color }} />;
}

function Panel({ title, aside, className, children }: { title: string; aside?: ReactNode; className: string; children: ReactNode }) {
  return (
    <section className={`${s.panel} ${className}`}>
      <div className={s.panelHead}>
        <h2>{title}</h2>
        {aside && <span className={s.muted}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

async function Painel({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const email = await getSessionEmail();
  if (!email) redirect("/login");
  const userId = await getOrCreateUserId(email);
  const data = await loadFinance(userId);

  const current = monthOf(data.today);
  const requested = (await searchParams).mes;
  const month = typeof requested === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : current;
  const cardById = new Map<string, CardRules>(data.cards.map((c) => [c.id, c]));

  const summary = monthSummary(data.entries, month, data.incomeFor(month), data.budgetsFor(month));
  const committedPct = summary.incomeCents > 0 ? Math.round((1000 * summary.totalCents) / summary.incomeCents) / 10 : null;
  const nextSummary = monthSummary(data.entries, addMonths(month, 1), 0, new Map());

  const horizon = 12;
  const bills = billsByCard(data.entries, month, horizon);
  const ahead = outlook(data.entries, month, horizon, data.incomeFor);
  const cardSeries: Series[] = data.cards.map((c) => ({ key: c.id, label: c.name, color: cardColor(data, c.id) }));
  const monthXs = bills.map((b) => ({ key: b.month, label: monthShortLabel(b.month), tipTitle: monthLabel(b.month), highlight: b.month === month }));

  const days = dailySpend(data.entries, addDays(data.today, -29), data.today);
  const daysTotal = days.reduce((a, d) => a + d.cents, 0);
  const today = cardsToday(data.cards, data.entries, data.today);
  const installments = activeInstallments(data.entries, month);
  const installmentsMonthly = installments.reduce((a, i) => a + i.installmentCents, 0);
  const installmentsRemaining = installments.reduce((a, i) => a + i.remainingCents, 0);
  const endingSoon = installments.filter((i) => i.lastMonth <= addMonths(month, 2));
  const relief = endingSoon.reduce((a, i) => a + i.installmentCents, 0);
  const week = purchasesBetween(data.entries, addDays(data.today, -6), data.today);

  const compSeries: Series[] = [
    { key: "fixed", label: "Contas fixas", color: "var(--c-fixed)" },
    { key: "inst", label: "Parcelas", color: "var(--c-inst)" },
    { key: "single", label: "Compras à vista já feitas", color: "var(--c-single)" },
  ];

  return (
    <TooltipLayer>
      <div className={s.stack}>
        {data.warnings.map((w) => (
          <p key={w} className={s.warning}>
            {w}
          </p>
        ))}

        <div className={s.header}>
          <div>
            <h1>Painel do cartão</h1>
            <p className={s.sub}>Competência = mês em que a fatura vence. Hoje: {dayLabel(data.today)}.</p>
          </div>
          <nav className={s.filters} aria-label="Competência">
            <Link href={`/orcamento?mes=${addMonths(month, -1)}`} aria-label="Mês anterior">
              ←
            </Link>
            <Link href="/orcamento" className={month === current ? s.active : undefined}>
              {monthShortLabel(current)}
            </Link>
            <Link href={`/orcamento?mes=${addMonths(current, 1)}`} className={month === addMonths(current, 1) ? s.active : undefined}>
              {monthShortLabel(addMonths(current, 1))}
            </Link>
            {month !== current && month !== addMonths(current, 1) && <span className={`${s.active} ${s.filterChip}`}>{monthShortLabel(month)}</span>}
            <Link href={`/orcamento?mes=${addMonths(month, 1)}`} aria-label="Próximo mês">
              →
            </Link>
          </nav>
        </div>

        <div className={s.grid}>
          {/* Hero: a fatura do mês */}
          <section className={`${s.panel} ${s.span7}`}>
            <div className={s.heroLabel}>Faturas a pagar em {monthLabel(month)}</div>
            <div className={s.heroValue}>{brlCents(summary.cardsCents)}</div>
            <div className={s.muted}>
              {brlCents(summary.pastInstallmentsCents)} são parcelas de compras de meses anteriores · {brlCents(summary.newPurchasesCents)} de compras do ciclo
            </div>
            <div className={s.heroCards}>
              {data.cards.map((c) => {
                const v = summary.byCard.find((b) => b.cardId === c.id);
                const total = (v?.postedCents ?? 0) + (v?.projectedCents ?? 0);
                return (
                  <div key={c.id} className={s.heroCardRow}>
                    <Swatch color={cardColor(data, c.id)} />
                    <span>{c.name}</span>
                    <span className={s.muted}>vence {dayLabel(dueDateInMonth(month, c))}</span>
                    <b className={s.num}>{brlCents(total)}</b>
                  </div>
                );
              })}
            </div>
          </section>

          {/* KPIs */}
          <section className={`${s.span5}`}>
            <div className={s.kpis}>
              <div className={s.kpi}>
                <span className={s.kpiLabel}>Renda do mês</span>
                <span className={s.kpiValue}>{brlCents(summary.incomeCents)}</span>
              </div>
              <div className={s.kpi}>
                <span className={s.kpiLabel}>Contas fixas</span>
                <span className={s.kpiValue}>{brlCents(summary.fixedCents)}</span>
              </div>
              <div className={s.kpi}>
                <span className={s.kpiLabel}>Sobra prevista</span>
                <span className={`${s.kpiValue} ${summary.leftoverCents >= 0 ? s.good : s.bad}`}>{brlCents(summary.leftoverCents)}</span>
                <span className={s.muted}>{summary.leftoverCents >= 0 ? "▲ positiva" : "▼ faltando"}</span>
              </div>
              <div className={s.kpi}>
                <span className={s.kpiLabel}>Renda comprometida</span>
                <span className={s.kpiValue}>{percentLabel(committedPct)}</span>
                <div className={s.meter} role="meter" aria-valuenow={committedPct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Renda comprometida">
                  <span
                    className={usageTone(committedPct) === "bad" ? s.segBad : usageTone(committedPct) === "warn" ? s.segWarn : s.segNow}
                    style={{ width: `${Math.min(committedPct ?? 0, 100)}%` }}
                  />
                </div>
              </div>
              <div className={s.kpi} style={{ gridColumn: "span 2" }}>
                <span className={s.kpiLabel}>Já lançado em {monthLabel(addMonths(month, 1))}</span>
                <span className={s.kpiValue}>{brlCents(nextSummary.cardsCents)}</span>
                <span className={s.muted}>inclui {brlCents(nextSummary.pastInstallmentsCents)} de parcelas antigas</span>
              </div>
            </div>
          </section>

          {/* Faturas por cartão */}
          <Panel title="Faturas por cartão — próximos 12 meses" aside="meses futuros: só o que já foi comprado + parcelas projetadas" className={s.span12}>
            <Legend items={cardSeries} line="Renda − contas fixas" />
            <StackedColumns
              ariaLabel="Faturas por cartão nos próximos 12 meses"
              xs={monthXs}
              series={cardSeries}
              values={bills.map((b) => data.cards.map((c) => { const v = b.byCard.get(c.id); return (v?.postedCents ?? 0) + (v?.projectedCents ?? 0); }))}
              reference={{ label: "Renda − fixas", values: ahead.map((a) => a.incomeCents - a.fixedCents) }}
            />
            <details className={s.details}>
              <summary>Ver tabela</summary>
              <div className={s.chartScroll}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Mês</th>
                      {data.cards.map((c) => (
                        <th key={c.id} className={s.num}>{c.name}</th>
                      ))}
                      <th className={s.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b) => (
                      <tr key={b.month}>
                        <td>{monthLabel(b.month)}</td>
                        {data.cards.map((c) => { const v = b.byCard.get(c.id); return <td key={c.id} className={s.num}>{brlCents((v?.postedCents ?? 0) + (v?.projectedCents ?? 0))}</td>; })}
                        <td className={s.num}>{brlCents(b.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Panel>

          {/* Orçamento por categoria */}
          <Panel title={`Orçamento por categoria — ${monthLabel(month)}`} aside={`orçado ${brlCents(summary.budgetTotalCents)}`} className={s.span7}>
            <ul className={s.legend}>
              <li><span className={`${s.swatch} ${s.segPast}`} />parcelas de meses anteriores</li>
              <li><span className={`${s.swatch} ${s.segNow}`} />compras do ciclo e fixas</li>
              <li>⚠ acima de 80% · ✕ estourou</li>
            </ul>
            {summary.categories.length === 0 ? (
              <p className={s.muted}>Nada lançado nesta competência.</p>
            ) : (
              <div className={s.meterList}>
                {summary.categories.map((c) => {
                  const scale = Math.max(c.budgetCents, c.totalCents, 1);
                  const tone = usageTone(c.usePercent);
                  const nowCents = Math.max(c.newCents + c.fixedCents, 0);
                  return (
                    <div key={c.category} className={s.meterRow}>
                      <span>
                        {c.category} {tone === "bad" ? <span className={s.bad} title="estourou">✕</span> : tone === "warn" ? <span title="acima de 80%">⚠</span> : null}
                      </span>
                      <div
                        className={s.meter}
                        data-tip={JSON.stringify({ t: c.category, r: [[null, "Orçado", c.budgetCents ? brlCents(c.budgetCents) : "—"], ["var(--s1-soft)", "Parcelas antigas", brlCents(c.pastInstallmentsCents)], ["var(--s1)", "Ciclo e fixas", brlCents(nowCents)], [null, "Disponível", c.budgetCents ? brlCents(c.availableCents) : "—"]] })}
                        tabIndex={0}
                      >
                        <span className={s.segPast} style={{ width: `${(100 * Math.max(c.pastInstallmentsCents, 0)) / scale}%` }} />
                        <span className={tone === "bad" ? s.segBad : s.segNow} style={{ width: `${(100 * nowCents) / scale}%` }} />
                      </div>
                      <span className={s.figures}>
                        <b>{brlCents(c.totalCents)}</b>
                        <span className={s.muted}> / {c.budgetCents ? brlCents(c.budgetCents) : "sem limite"}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Gasto por dia */}
          <Panel title="Compras por dia — últimos 30 dias" aside={`total ${brlCents(daysTotal)}`} className={s.span5}>
            <StackedColumns
              ariaLabel="Compras por dia nos últimos 30 dias"
              xs={days.map((d) => ({ key: d.date, label: dayLabel(d.date), tipTitle: dayLabel(d.date), highlight: d.date === data.today }))}
              series={[{ key: "d", label: "Compras", color: "var(--s1)" }]}
              values={days.map((d) => [d.cents])}
              labelEvery={7}
              height={300}
              width={460}
            />
            <p className={s.muted}>Pela data da compra, em todos os cartões. Parcelas de compras antigas não entram.</p>
          </Panel>

          {/* Cartões */}
          <Panel title="Cartões hoje" aside="ordenados pelo prazo: o primeiro é o que demora mais para cobrar" className={s.span12}>
            {today.length === 0 ? (
              <p className={s.muted}>
                Cadastre seus cartões em <Link href="/configuracoes">Configurações</Link>.
              </p>
            ) : (
              <div className={s.cardTiles}>
                {today.map((c, i) => {
                  const card = cardById.get(c.cardId);
                  const cycle = card ? cycleProgress(data.today, card) : null;
                  const info = data.cardInfo.get(c.cardId);
                  const limitPct = info?.creditLimitCents && info.usedCents !== null ? Math.round((100 * info.usedCents) / info.creditLimitCents) : null;
                  return (
                    <div key={c.cardId} className={s.cardTile}>
                      <div className={s.cardTileHead}>
                        <span className={s.cardName}>
                          <Swatch color={cardColor(data, c.cardId)} />
                          <span>{c.name}</span>
                        </span>
                        {i === 0 && today.length > 1 && <span className={`${s.badge} ${s.good}`}>✓ melhor hoje</span>}
                      </div>
                      <div>
                        <div className={s.muted}>Fatura aberta · vence {dayLabel(c.dueOn)}</div>
                        <div className={s.cardBig}>{brlCents(c.openBillCents)}</div>
                      </div>
                      {cycle && (
                        <div>
                          <div className={s.kv}>
                            <span>Ciclo</span>
                            <b>fecha {dayLabel(c.closesOn)} · em {c.daysUntilClosing}d</b>
                          </div>
                          <div className={`${s.meter} ${s.meterThin}`} aria-label={`Ciclo ${cycle.elapsedDays} de ${cycle.totalDays} dias`}>
                            <span className={s.segNow} style={{ width: `${(100 * cycle.elapsedDays) / Math.max(cycle.totalDays, 1)}%` }} />
                          </div>
                        </div>
                      )}
                      <div className={s.kv}>
                        <span>Compra hoje paga em</span>
                        <b>{c.daysOfCredit} dias</b>
                      </div>
                      {limitPct !== null && info?.creditLimitCents && (
                        <div>
                          <div className={s.kv}>
                            <span>Limite usado</span>
                            <b>
                              {limitPct}% de {brlCents(info.creditLimitCents)}
                            </b>
                          </div>
                          <div className={`${s.meter} ${s.meterThin}`}>
                            <span className={limitPct > 90 ? s.segBad : limitPct >= 70 ? s.segWarn : s.segNow} style={{ width: `${Math.min(limitPct, 100)}%` }} />
                          </div>
                        </div>
                      )}
                      {c.rewards && <div className={s.muted}>{c.rewards}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Comprometimento futuro */}
          <Panel title="Comprometimento da renda — próximos 12 meses" aside="piso já comprometido; compras futuras ainda não entram" className={s.span7}>
            <Legend items={compSeries} line="Renda" />
            <StackedColumns
              ariaLabel="Comprometimento da renda nos próximos 12 meses"
              xs={monthXs}
              series={compSeries}
              values={ahead.map((a) => [a.fixedCents, a.installmentsCents, a.singlePurchasesCents])}
              width={560}
              labelEvery={2}
              reference={{ label: "Renda", values: ahead.map((a) => a.incomeCents) }}
            />
            <details className={s.details}>
              <summary>Ver tabela</summary>
              <div className={s.chartScroll}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th className={s.num}>Renda</th>
                      <th className={s.num}>Fixas</th>
                      <th className={s.num}>Parcelas</th>
                      <th className={s.num}>À vista</th>
                      <th className={s.num}>Livre</th>
                      <th className={s.num}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ahead.map((a) => (
                      <tr key={a.month}>
                        <td>{monthLabel(a.month)}</td>
                        <td className={s.num}>{brlCents(a.incomeCents)}</td>
                        <td className={s.num}>{brlCents(a.fixedCents)}</td>
                        <td className={s.num}>{brlCents(a.installmentsCents)}</td>
                        <td className={s.num}>{brlCents(a.singlePurchasesCents)}</td>
                        <td className={`${s.num} ${a.freeCents < 0 ? s.bad : ""}`}>{brlCents(a.freeCents)}</td>
                        <td className={s.num}>{percentLabel(a.committedPercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Panel>

          {/* Parcelas ativas */}
          <Panel title="Parcelas ativas" aside={`${installments.length} compras`} className={s.span5}>
            <div className={s.kpis} style={{ height: "auto", marginBottom: 12 }}>
              <div className={s.kpi}>
                <span className={s.kpiLabel}>Por mês agora</span>
                <span className={s.kpiValue}>{brlCents(installmentsMonthly)}</span>
              </div>
              <div className={s.kpi}>
                <span className={s.kpiLabel}>Ainda a pagar depois</span>
                <span className={s.kpiValue}>{brlCents(installmentsRemaining)}</span>
              </div>
            </div>
            {relief > 0 && (
              <p className={s.sub} style={{ marginBottom: 8 }}>
                <span className={s.good}>▲</span> {endingSoon.length} parcelamento(s) terminam até {monthLabel(addMonths(month, 2))}, liberando {brlCents(relief)}/mês.
              </p>
            )}
            <div className={s.chartScroll}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Compra</th>
                    <th className={s.num}>Parcela</th>
                    <th className={s.num}>Valor</th>
                    <th>Termina</th>
                  </tr>
                </thead>
                <tbody>
                  {installments.slice(0, 10).map((i) => (
                    <tr key={i.key}>
                      <td>
                        <span className={s.cardName} style={{ fontWeight: 400 }}>
                          <Swatch color={cardColor(data, i.cardId)} />
                          <span>{i.description}</span>
                        </span>
                      </td>
                      <td className={s.num}>
                        {i.currentInstallment}/{i.totalInstallments}
                      </td>
                      <td className={s.num}>{brlCents(i.installmentCents)}</td>
                      <td>{monthShortLabel(i.lastMonth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {installments.length > 10 && <p className={s.muted}>+ {installments.length - 10} parcelamentos menores ou mais longos.</p>}
          </Panel>

          {/* Compras recentes */}
          <Panel title="Compras dos últimos 7 dias" aside={`total ${brlCents(week.reduce((a, e) => a + e.cents, 0))}`} className={s.span12}>
            {week.length === 0 ? (
              <p className={s.muted}>Nenhuma compra no período.</p>
            ) : (
              <div className={s.chartScroll}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th>Cartão</th>
                      <th>Categoria</th>
                      <th className={s.num}>Valor</th>
                      <th>Paga em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {week.map((e) => (
                      <tr key={e.id}>
                        <td>{dayLabel(e.date)}</td>
                        <td>
                          {e.description}
                          {e.installment && <span className={s.muted}> ({e.installment}/{e.totalInstallments})</span>}
                        </td>
                        <td>
                          <span className={s.cardName} style={{ fontWeight: 400 }}>
                            <Swatch color={cardColor(data, e.cardId)} />
                            <span>{data.cardNames.get(e.cardId ?? "") ?? ""}</span>
                          </span>
                        </td>
                        <td>{e.category}</td>
                        <td className={s.num}>{brlCents(e.cents)}</td>
                        <td>{monthShortLabel(e.month)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </TooltipLayer>
  );
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className={s.root}>
      <Nav current="/orcamento" />
      <Suspense fallback={<p className={s.muted}>Carregando painel…</p>}>
        <Painel searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
