/**
 * Conversões de dinheiro. A Pluggy entrega valores como `number`;
 * aqui eles viram strings com 2 casas, que é como o Postgres (numeric) guarda.
 * Nunca some valores em `number` para gravar: use SQL (`sum`) ou strings.
 */

/** 12.3 -> "12.30"; null/undefined/NaN -> null */
export function toMoney(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  // Arredonda em centavos antes de formatar, para evitar 0.1+0.2 = 0.30000000000000004
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * Valor com sinal a partir do tipo da transação:
 * DEBIT (saída) fica negativo, CREDIT (entrada) fica positivo.
 * Usa o campo `type` em vez do sinal original, que varia entre tipos de conta.
 */
export function signedAmount(amount: number, type: "DEBIT" | "CREDIT"): string {
  const absolute = Math.abs(amount);
  return toMoney(type === "DEBIT" ? -absolute : absolute) ?? "0.00";
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Só para exibição: "1234.5" -> "R$ 1.234,50" */
export function formatBRL(value: string | null | undefined, currencyCode = "BRL"): string {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (currencyCode === "BRL") return brl.format(number);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currencyCode }).format(number);
}
