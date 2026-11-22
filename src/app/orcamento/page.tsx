import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { type MonthSummary, addDays, addMonths, cardsToday, monthOf, monthSummary, outlook, purchasesBetween } from "@/lib/finance/core";
import { brlCents, dayLabel, monthLabel, percentLabel } from "@/lib/finance/format";
import { loadFinance } from "@/lib/finance/load";
import { getSessionEmail } from "@/lib/session";
import { getOrCreateUserId } from "@/lib/users";
import { Nav } from "../components/Nav";
import fin from "../finance.module.css";
import styles from "../page.module.css";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function usageClass(p: number | null): string {
  if (p === null) return "";
  if (p > 100) return styles.negative;
  if (p >= 80) return fin.warn;
  return styles.positive;
}

function Summary({ title, s, cardNames }: { title: string; s: MonthSummary; cardNames: Map<string, string> }) {
  const kpis = [
    { label: "Renda", value: s.incomeCents },
    { label: "Contas fixas", value: s.fixedCents },
    { label: "Cartões", value: s.cardsCents },
    { label: "Parcelas de meses anteriores", value: s.pastInstallmentsCents },
    { label: "Sobra prevista", value: s.leftoverCents, cls: s.leftoverCents >= 0 ? styles.positive : styles.negative },
  ];
  return (
    <section className={styles.card}>
      <h2>
        {title}: {monthLabel(s.month)}
      </h2>
      <div className={fin.kpis}>
        {kpis.map((k) => (
          <div key={k.label} className={fin.kpi}>
            <div className={fin.kpiLabel}>{k.label}</div>
            <div className={`${fin.kpiValue} ${k.cls ?? ""}`}>{brlCents(k.value)}</div>
          </div>
        ))}
      </div>
      {s.categories.length === 0 ? (
        <p className={styles.muted}>Nada lançado nesta competência ainda.</p>
      ) : (
        <>
          <p className={fin.legend}>
            <span>
              <i className={`${fin.swatch} ${fin.meterPast}`} />
              parcelas de meses anteriores
            </span>
            <span>
              <i className={`${fin.swatch} ${fin.meterNow}`} />
              compras do ciclo e contas fixas
            </span>
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Categoria</th>
                <th className={styles.num}>Orçado</th>
                <th className={styles.num}>Usado</th>
                <th aria-label="Consumo" />
                <th className={styles.num}>Disponível</th>
                <th className={styles.num}>Uso</th>
              </tr>
            </thead>
            <tbody>
              {s.categories.map((c) => {
                const scale = Math.max(c.budgetCents, c.totalCents, 1);
                return (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td className={styles.num}>{c.budgetCents ? brlCents(c.budgetCents) : "—"}</td>
                    <td className={styles.num}>{brlCents(c.totalCents)}</td>
                    <td>
                      <div className={fin.meter} title={`Parcelas antigas: ${brlCents(c.pastInstallmentsCents)}`}>
                        <span className={fin.meterPast} style={{ width: `${(100 * Math.max(c.pastInstallmentsCents, 0)) / scale}%` }} />
                        <span className={fin.meterNow} style={{ width: `${(100 * Math.max(c.newCents + c.fixedCents, 0)) / scale}%` }} />
                      </div>
                    </td>
                    <td className={`${styles.num} ${usageClass(c.usePercent)}`}>{c.budgetCents ? brlCents(c.availableCents) : "—"}</td>
                    <td className={`${styles.num} ${usageClass(c.usePercent)}`}>{percentLabel(c.usePercent)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {s.byCard.length > 0 && (
        <p className={styles.muted}>
          Por cartão:{" "}
          {s.byCard
            .map((c) => `${cardNames.get(c.cardId) ?? "Cartão"} ${brlCents(c.postedCents + c.projectedCents)}${c.projectedCents ? ` (inclui ${brlCents(c.projectedCents)} de parcelas projetadas)` : ""}`)
            .join(" · ")}
        </p>
      )}
    </section>
  );
}

async function Orcamento({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const email = await getSessionEmail();
  if (!email) redirect("/login");
  const userId = await getOrCreateUserId(email);
  const data = await loadFinance(userId);

  const requested = (await searchParams).mes;
  const current = monthOf(data.today);
  const month = typeof requested === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : current;
  const next = addMonths(month, 1);

  const summaryThis = monthSummary(data.entries, month, data.incomeFor(month), data.budgetsFor(month));
  const summaryNext = monthSummary(data.entries, next, data.incomeFor(next), data.budgetsFor(next));
  const today = cardsToday(data.cards, data.entries, data.today);
  const ahead = outlook(data.entries, current, 12, data.incomeFor);
  const week = purchasesBetween(data.entries, addDays(data.today, -6), data.today);
  const weekTotal = week.reduce((a, e) => a + e.cents, 0);
  const maxOutlook = Math.max(1, ...ahead.map((x) => Math.max(x.incomeCents, x.committedCents)));

  return (
    <>
      {data.warnings.map((w) => (
        <p key={w} className={fin.warning}>
          {w}
        </p>
      ))}

      <div className={styles.row}>
        <Link href={`/orcamento?mes=${addMonths(month, -1)}`}>← {monthLabel(addMonths(month, -1))}</Link>
        {month !== current && <Link href="/orcamento">Voltar para o mês atual</Link>}
        <Link href={`/orcamento?mes=${next}`}>{monthLabel(next)} →</Link>
      </div>

      <Summary title={month === current ? "Este mês (faturas que você paga agora)" : "Competência"} s={summaryThis} cardNames={data.cardNames} />
      <Summary title={month === current ? "Próximo mês (o que você está comprando agora)" : "Competência seguinte"} s={summaryNext} cardNames={data.cardNames} />

      <section className={styles.card}>
        <h2>Onde comprar hoje</h2>
        {today.length === 0 ? (
          <p className={styles.muted}>
            Cadastre seus cartões em <Link href="/configuracoes">Configurações</Link>.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Cartão</th>
                <th>Fecha</th>
                <th>Vence</th>
                <th className={styles.num}>Dias até pagar</th>
                <th className={styles.num}>Fatura aberta</th>
                <th>Pontos</th>
              </tr>
            </thead>
            <tbody>
              {today.map((c) => (
                <tr key={c.cardId}>
                  <td>{c.name}</td>
                  <td>
                    {dayLabel(c.closesOn)} <span className={styles.muted}>(em {c.daysUntilClosing}d)</span>
                  </td>
                  <td>{dayLabel(c.dueOn)}</td>
                  <td className={styles.num}>{c.daysOfCredit}</td>
                  <td className={styles.num}>{brlCents(c.openBillCents)}</td>
                  <td>{c.rewards ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={styles.muted}>Ordenado pelo prazo: uma compra feita hoje no primeiro cartão é a que demora mais para ser paga.</p>
      </section>

      <section className={styles.card}>
        <h2>Comprometimento dos próximos meses</h2>
        <p className={fin.legend}>
          <span>
            <i className={`${fin.swatch} ${fin.meterPast}`} />
            contas fixas
          </span>
          <span>
            <i className={`${fin.swatch} ${fin.meterNow}`} />
            parcelas e compras já feitas
          </span>
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Mês</th>
              <th className={styles.num}>Renda</th>
              <th className={styles.num}>Parcelas</th>
              <th className={styles.num}>Comprometido</th>
              <th aria-label="Proporção" />
              <th className={styles.num}>Livre</th>
              <th className={styles.num}>%</th>
            </tr>
          </thead>
          <tbody>
            {ahead.map((x) => (
              <tr key={x.month}>
                <td>{monthLabel(x.month)}</td>
                <td className={styles.num}>{brlCents(x.incomeCents)}</td>
                <td className={styles.num}>{brlCents(x.installmentsCents)}</td>
                <td className={styles.num}>{brlCents(x.committedCents)}</td>
                <td>
                  <div className={fin.meter}>
                    <span className={fin.meterPast} style={{ width: `${(100 * x.fixedCents) / maxOutlook}%` }} />
                    <span className={fin.meterNow} style={{ width: `${(100 * Math.max(x.installmentsCents + x.singlePurchasesCents, 0)) / maxOutlook}%` }} />
                  </div>
                </td>
                <td className={`${styles.num} ${x.freeCents < 0 ? styles.negative : ""}`}>{brlCents(x.freeCents)}</td>
                <td className={`${styles.num} ${usageClass(x.committedPercent)}`}>{percentLabel(x.committedPercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.muted}>Compras que você ainda vai fazer não entram aqui; é o piso já comprometido.</p>
      </section>

      <section className={styles.card}>
        <h2>Compras dos últimos 7 dias: {brlCents(weekTotal)}</h2>
        {week.length === 0 ? (
          <p className={styles.muted}>Nenhuma compra no período.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th className={styles.num}>Valor</th>
                <th>Paga em</th>
              </tr>
            </thead>
            <tbody>
              {week.map((e) => (
                <tr key={e.id}>
                  <td>{dayLabel(e.date)}</td>
                  <td>
                    {e.description}
                    {e.installment && <span className={styles.muted}> ({e.installment}/{e.totalInstallments})</span>}
                    <div className={styles.muted}>{data.cardNames.get(e.cardId ?? "") ?? ""}</div>
                  </td>
                  <td>{e.category}</td>
                  <td className={styles.num}>{brlCents(e.cents)}</td>
                  <td>{monthLabel(e.month)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className={styles.main}>
      <Nav current="/orcamento" />
      <h1>Orçamento</h1>
      <p className={styles.muted}>Competência = mês em que a fatura é paga, não o mês da compra.</p>
      <Suspense fallback={<p>Carregando…</p>}>
        <Orcamento searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
