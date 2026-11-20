"use client";

import { useState, useTransition } from "react";
import { removerConexao, sincronizarAgora, type ActionResult } from "../actions";
import styles from "../page.module.css";

export function ConnectionActions({ connectionId, connectorName }: { connectionId: string; connectorName: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.secondary}
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await sincronizarAgora(connectionId)))}
      >
        Sincronizar agora
      </button>
      <button
        type="button"
        className={styles.danger}
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Desconectar ${connectorName} e apagar todos os dados dele daqui e da Pluggy?`)) return;
          startTransition(async () => setResult(await removerConexao(connectionId)));
        }}
      >
        Desconectar
      </button>
      {result && <span className={result.ok ? styles.muted : styles.error}>{result.message}</span>}
    </div>
  );
}
