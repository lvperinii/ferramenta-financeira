"use client";

import { type ReactNode, useCallback, useRef, useState } from "react";
import styles from "../dashboard.module.css";

/** Conteúdo serializado em `data-tip` nas marcas dos gráficos (gerado no servidor). */
export type TipData = { t: string; r: [color: string | null, label: string, value: string][] };

type State = { left: number; top: number; tip: TipData } | null;

/**
 * Camada de tooltip: qualquer elemento com `data-tip` dentro dela mostra o
 * tooltip ao passar o mouse ou ao receber foco pelo teclado. O texto é
 * renderizado pelo React (escapado), nunca como HTML.
 */
export function TooltipLayer({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(null);

  const show = useCallback((target: EventTarget | null, clientX?: number, clientY?: number) => {
    const el = target instanceof Element ? target.closest<HTMLElement | SVGElement>("[data-tip]") : null;
    const box = host.current?.getBoundingClientRect();
    if (!el || !box) return setState(null);
    let tip: TipData;
    try {
      tip = JSON.parse(el.getAttribute("data-tip") ?? "");
    } catch {
      return setState(null);
    }
    const r = el.getBoundingClientRect();
    const x = (clientX ?? r.left + r.width / 2) - box.left;
    const y = (clientY ?? r.top) - box.top;
    // Mantém o tooltip dentro da área do painel.
    setState({ left: Math.max(0, Math.min(x + 14, box.width - 270)), top: Math.max(0, y - 10), tip });
  }, []);

  return (
    <div
      ref={host}
      className={styles.tooltipHost}
      onPointerMove={(e) => show(e.target, e.clientX, e.clientY)}
      onPointerLeave={() => setState(null)}
      onFocus={(e) => show(e.target)}
      onBlur={() => setState(null)}
    >
      {children}
      {state && (
        <div className={styles.tooltip} style={{ left: state.left, top: state.top }} role="status">
          <strong>{state.tip.t}</strong>
          {state.tip.r.map(([color, label, value]) => (
            <div key={label} className={styles.tipRow}>
              <span className={styles.lineKey} style={color ? { background: color } : { background: "transparent" }} />
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
