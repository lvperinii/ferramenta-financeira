# Ferramenta Financeira

Controle financeiro pessoal com Open Finance (Pluggy): gastos por categoria,
orçamento mensal, saldo e patrimônio, gráficos e relatórios. Acesso restrito
por login com Google.

- Arquitetura e segurança: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- Plano por fases: [docs/PLANO.md](docs/PLANO.md)

## Rodar localmente

Requer Node.js 20.9+.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Preencha `.env.local` (instruções no próprio arquivo) e então:

```bash
npm run dev
```

Abra http://localhost:3000.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run check` | Lint + typecheck + testes |
| `npm test` | Testes das regras de fatura e orçamento |
| `npm run db:generate` | Gera migração SQL a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica migrações (usa `DATABASE_URL_UNPOOLED`) |

## Segurança

- Nunca versione `.env.local` nem cole chaves em issues/PRs.
- Ative a verificação em duas etapas na conta Google usada no login.
- Use credenciais **sandbox** da Pluggy em desenvolvimento.
