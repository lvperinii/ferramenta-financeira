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
