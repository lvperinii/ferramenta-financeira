/**
 * Garante `sslmode=verify-full` (TLS com verificação do certificado do servidor).
 *
 * O driver `pg` v8 já trata prefer/require/verify-ca como verify-full, mas avisa
 * que no v9 eles passarão a ter a semântica do libpq, mais fraca. Tornar o modo
 * explícito mantém a proteção atual depois da atualização e remove o aviso.
 * URLs sem sslmode (ex.: Postgres local de testes) não são alteradas.
 */
export function withVerifyFullSsl(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }
  const mode = url.searchParams.get("sslmode");
  if (mode === "prefer" || mode === "require" || mode === "verify-ca") {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}
