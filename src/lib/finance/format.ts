import { formatBRL } from "@/lib/money";
import { centsToMoney } from "./core";

export function brlCents(cents: number): string {
  return formatBRL(centsToMoney(cents));
}

const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** "2026-12" -> "dezembro de 2026" */
export function monthLabel(month: string): string {
  return monthName.format(new Date(`${month}-01T00:00:00Z`));
}

/** "2026-12-05" -> "05/12" */
export function dayLabel(date: string): string {
  return shortDate.format(new Date(`${date}T00:00:00Z`));
}

export function percentLabel(p: number | null): string {
  return p === null ? "—" : `${Math.round(p)}%`;
}

const compact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const monthShort = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

/** 1234500 -> "R$ 12,3 mil" (eixos e rótulos curtos). */
export function brlCompact(cents: number): string {
  return compact.format(cents / 100);
}

/** "2026-12" -> "dez/26" */
export function monthShortLabel(month: string): string {
  const m = monthShort.format(new Date(`${month}-01T00:00:00Z`)).replace(".", "");
  return `${m}/${month.slice(2, 4)}`;
}

/** Marcas "redondas" para o eixo Y: [0, passo, 2*passo, ...] cobrindo `max`. */
export function niceTicks(maxCents: number, count = 4): number[] {
  if (maxCents <= 0) return [0];
  const raw = maxCents / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < maxCents + step; v += step) ticks.push(Math.round(v));
  return ticks;
}
