# Plano de desenvolvimento

Detalhes técnicos em [ARQUITETURA.md](./ARQUITETURA.md).

| Fase | Entrega | Pluggy | Status |
|---|---|---|---|
| **0. Base** | Next.js + TypeScript, login com Google restrito, proxy de sessão, rota de connect token, schema do banco, headers de segurança, CI, Dependabot | — | ✅ |
| **1. Conexão** | Widget Pluggy Connect, CSP completa, `POST /api/pluggy/items`, webhook com segredo e idempotência, sincronização de contas/transações/investimentos, reconectar/desconectar, workflow de migrações | Sandbox | ✅ testado com o sandbox da Pluggy (conectar, sincronizar, desconectar) |
| **2. Gastos por categoria** | Lista com filtros, recategorizar, totais do mês | Sandbox | ⏳ |
| **3. Orçamento mensal** | Limite por categoria, progresso, alerta | Sandbox | 🟡 orçamento por fatura do cartão (competência), cadastro de cartões/renda/contas fixas, parcelas projetadas e comprometimento futuro — testado com dados fictícios; falta validar com dados reais |
| **4. Saldo e patrimônio** | Saldos e investimentos consolidados | Sandbox | ⏳ |
| **5. Gráficos e relatórios** | Evolução mensal, comparativos, exportar CSV | Sandbox | ⏳ |
| **6. Produção** | Credenciais reais, deploy de produção, conectar seus bancos | Real | ⏳ |

## O que você precisa providenciar

1. **Google OAuth** — Google Cloud Console → Credenciais → ID do cliente OAuth
   (Aplicativo da Web), com os redirects listados no `.env.example`.
2. **Pluggy** — Client ID e Client Secret de teste/sandbox.
3. **Neon** — projeto Postgres (connection strings pooled e direta).
4. **Vercel** — projeto ligado a este repositório, com as variáveis de ambiente.
5. **Conta Google** — verificação em duas etapas ativada.

Nunca cole chaves no chat ou em issues: cadastre direto na Vercel / `.env.local`.
