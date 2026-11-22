import { brlCents, brlCompact, niceTicks } from "@/lib/finance/format";
import styles from "../dashboard.module.css";
import type { TipData } from "./TooltipLayer";

export type Series = { key: string; label: string; color: string };
export type XPoint = { key: string; label: string; tipTitle: string; highlight?: boolean };

type Props = {
  ariaLabel: string;
  xs: XPoint[];
  series: Series[];
  /** values[x][s] em centavos (negativos viram 0 no desenho; o tooltip mostra o valor real). */
  values: number[][];
  /** Linha de referência na MESMA escala (ex.: renda), desenhada em degraus. */
  reference?: { label: string; values: number[] };
  labelEvery?: number;
  height?: number;
  /** Largura do viewBox: menor em painéis estreitos, para o texto não encolher demais. */
  width?: number;
};

const PAD = { top: 14, right: 96, bottom: 30, left: 70 };
const GAP = 2; // espaço da superfície entre segmentos
const R = 4; // raio da ponta de dados

function topRoundedRect(x: number, y: number, w: number, h: number): string {
  const r = Math.min(R, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Colunas empilhadas em SVG gerado no servidor (marcas finas, cantos de 4px
 * só na ponta, 2px de respiro entre segmentos, grade em linhas finas sólidas).
 * Interação: cada coluna é um alvo com `data-tip` (mouse e teclado).
 */
export function StackedColumns({ ariaLabel, xs, series, values, reference, labelEvery = 1, height = 260, width = 760 }: Props) {
  const W = width;
  const H = height;
  const padRight = reference ? PAD.right : 28;
  const plotW = W - PAD.left - padRight;
  const plotH = H - PAD.top - PAD.bottom;
  const totals = values.map((row) => row.reduce((a, v) => a + Math.max(v, 0), 0));
  const max = Math.max(1, ...totals, ...(reference?.values ?? []));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const y = (v: number) => PAD.top + plotH - (plotH * v) / top;
  const band = plotW / Math.max(xs.length, 1);
  const barW = Math.min(24, band * 0.62);

  let refPath = "";
  if (reference) {
    reference.values.forEach((v, i) => {
      const x0 = PAD.left + i * band;
      refPath += `${i === 0 ? "M" : "L"}${x0},${y(v)}H${x0 + band}`;
    });
  }

  return (
    <div className={styles.chartScroll}>
      <svg className={styles.chart} style={{ minWidth: Math.min(W, 520) }} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? styles.baseline : styles.gridline} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {brlCompact(t)}
            </text>
          </g>
        ))}

        {xs.map((pt, i) => {
          const cx = PAD.left + i * band + band / 2;
          const x = cx - barW / 2;
          const row = values[i] ?? [];
          let cum = 0;
          const lastIdx = row.reduce((last, v, s) => (v > 0 ? s : last), -1);
          const segments = row.map((raw, s) => {
            const v = Math.max(raw, 0);
            if (v <= 0) return null;
            const y0 = y(cum) - (cum > 0 ? GAP : 0);
            cum += v;
            const y1 = y(cum);
            const h = y0 - y1;
            if (h <= 0.5) return null;
            const fill = series[s].color;
            return s === lastIdx ? (
              <path key={series[s].key} d={topRoundedRect(x, y1, barW, h)} fill={fill} />
            ) : (
              <rect key={series[s].key} x={x} y={y1} width={barW} height={h} fill={fill} />
            );
          });
          const tip: TipData = {
            t: pt.tipTitle,
            r: [
              ...series.map((s, si): TipData["r"][number] => [s.color, s.label, brlCents(row[si] ?? 0)]),
              [null, "Total", brlCents(row.reduce((a, v) => a + v, 0))],
              ...(reference ? [[null, reference.label, brlCents(reference.values[i] ?? 0)] as TipData["r"][number]] : []),
            ],
          };
          const showLabel = i % labelEvery === 0 || pt.highlight;
          return (
            <g key={pt.key}>
              {segments}
              {showLabel && (
                <text x={cx} y={H - 10} textAnchor="middle" className={pt.highlight ? styles.now : undefined}>
                  {pt.label}
                </text>
              )}
              <rect
                className={styles.hit}
                x={PAD.left + i * band}
                y={PAD.top}
                width={band}
                height={plotH}
                data-tip={JSON.stringify(tip)}
                tabIndex={0}
                aria-label={`${pt.tipTitle}: total ${brlCents(row.reduce((a, v) => a + v, 0))}`}
              />
            </g>
          );
        })}

        {reference && (
          <>
            <path className={styles.refLine} d={refPath} />
            <text className={styles.refLabel} x={PAD.left + plotW + 6} y={y(reference.values[reference.values.length - 1] ?? 0) + 4}>
              {reference.label}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

export function Legend({ items, line }: { items: Series[]; line?: string }) {
  return (
    <ul className={styles.legend}>
      {items.map((s) => (
        <li key={s.key}>
          <span className={styles.swatch} style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
      {line && (
        <li>
          <span className={styles.lineKey} />
          {line}
        </li>
      )}
    </ul>
  );
}
