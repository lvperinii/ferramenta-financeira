"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PluggyConnect } from "react-pluggy-connect";
import styles from "../page.module.css";

type Props = {
  includeSandbox: boolean;
  /** Para reconectar um banco existente (ex.: senha mudou). */
  connectionId?: string;
  label?: string;
};

export function ConnectBank({ includeSandbox, connectionId, label = "Conectar banco" }: Props) {
  const router = useRouter();
  const [token, setToken] = useState<{ accessToken: string; itemId: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function abrir() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/pluggy/connect-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connectionId ? { connectionId } : {}),
      });
      if (!response.ok) throw new Error(String(response.status));
      setToken(await response.json());
    } catch {
      setMessage("Não foi possível iniciar a conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function registrar(itemId: string) {
    const response = await fetch("/api/pluggy/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    setMessage(
      response.ok
        ? "Banco conectado! Os dados aparecem assim que a sincronização terminar."
        : "O banco foi conectado, mas não consegui registrar. Tente atualizar a página.",
    );
    router.refresh();
  }

  return (
    <div>
      <button type="button" className={styles.button} onClick={abrir} disabled={loading}>
        {loading ? "Abrindo…" : label}
      </button>
      {message && <p className={styles.muted}>{message}</p>}
      {token && (
        <PluggyConnect
          connectToken={token.accessToken}
          includeSandbox={includeSandbox}
          updateItem={token.itemId ?? undefined}
          onSuccess={({ item }) => {
            setToken(null);
            void registrar(item.id);
          }}
          onError={() => setMessage("A conexão com o banco falhou. Tente novamente.")}
          onClose={() => setToken(null)}
        />
      )}
    </div>
  );
}
