@AGENTS.md

# Regras do projeto

- Idioma: responder ao usuário sempre em português.
- Leia `docs/ARQUITETURA.md` antes de mudanças estruturais e mantenha-o atualizado.
- Next.js 16: consulte `node_modules/next/dist/docs/` (ex.: `middleware` agora é `proxy`).
- Pluggy: siga `.claude/skills/pluggy-integration` e `.claude/skills/pluggy-open-finance`.
  No `pluggy-sdk` 0.94, `createConnectToken(itemId?, options?)` — opções no 2º parâmetro.
- Segurança: siga `.claude/skills/security-and-hardening`.
  - Chaves e segredos só em variáveis de ambiente do servidor; módulos que os usam importam `server-only`.
  - Toda rota/página com dados chama `auth()`; o proxy não é a única barreira.
  - Toda consulta filtra pelo usuário logado.
  - Dados de webhook nunca são gravados direto: refazer a busca na API da Pluggy.
  - Nunca logar tokens, valores de transação ou payloads completos.
- Dinheiro: `numeric(14,2)` / strings; nunca `number` em ponto flutuante para cálculos.
- Banco: mudanças de schema só via Drizzle (`npm run db:generate`), nunca SQL manual.
- Antes de abrir PR: `npm run check` e `npm run build`.
- Nunca incluir dados pessoais reais (e-mails, contas) no código ou nos testes.
