# Arquitetura — Ferramenta de Controle Financeiro Pessoal

> Documento vivo. Itens marcados com **[verificar]** dependem de informação
> de terceiros (preços, limites, comportamentos de serviços) que ainda não
> foi confirmada na documentação oficial.

## 1. Objetivo e requisitos

**Propósito:** consolidar, num só lugar e com acesso só seu, contas, cartões e
investimentos conectados via Open Finance (Pluggy), com:

1. Gastos por categoria
2. Orçamento mensal com alertas
3. Saldo e patrimônio consolidados
4. Gráficos e relatórios

**Requisitos não funcionais**

| Requisito | Meta |
|---|---|
| Confidencialidade | Dados financeiros acessíveis só a e-mails autorizados; credenciais nunca no navegador nem no Git |
| Integridade | Valores monetários exatos (sem ponto flutuante); sincronização idempotente |
| Disponibilidade | Acesso pela web e celular; tolerar indisponibilidade temporária da Pluggy |
| Privacidade (LGPD) | Mínimo de dados necessário; apagar uma conexão apaga seus dados |
| Custo | Começar nos planos gratuitos/baixos **[verificar]** |
| Manutenção | Um único projeto, tipado, com CI e atualizações automáticas de dependências |

## 2. Visão geral

```
                ┌──────────────────────────── Vercel ─────────────────────────────┐
 Navegador      │                                                                  │
 / celular ─────┼──► Proxy (src/proxy.ts) ── verifica cookie de sessão             │
  HTTPS         │        │                                                         │
                │        ▼                                                         │
                │   Páginas (Server Components)  ── auth() de novo ──┐             │
                │   Rotas de API (Route Handlers) ── auth() + origem ┤             │
                │        │                                           │             │
                │        ├──► Auth.js ◄──── OAuth ────► Google        │             │
                │        │                                           ▼             │
                │        ├──► Pluggy SDK (servidor) ◄──► API Pluggy ──► bancos      │
                │        │                                 │                       │
                │        │    /api/webhooks/pluggy/<seg> ◄─┘ (aviso de dados novos)│
                │        ▼                                                         │
                │   Drizzle ORM ──► Neon Postgres (pooled)                         │
                └──────────────────────────────────────────────────────────────────┘
```

**Stack**

| Camada | Escolha | Por quê |
|---|---|---|
| App | Next.js 16 (App Router) + TypeScript | Frontend e backend no mesmo projeto; Server Components não enviam segredos ao navegador |
| Login | Auth.js v5 + Google | Login com Gmail; o 2º fator fica na conta Google |
| Open Finance | Pluggy (`pluggy-sdk`) | Agregador com conectores dos bancos brasileiros |
| Banco | Neon Postgres + Drizzle ORM | Postgres gerenciado; schema e migrações versionados no código |
| Hospedagem | Vercel | Deploy por push; preview por PR |
| Validação | Zod | Valida variáveis de ambiente e payloads externos |

## 3. Segurança

### 3.1 Modelo de ameaças (resumo)

| Ameaça | Mitigação |
|---|---|
| Alguém acessa o app | Login só com Google; lista fechada `ALLOWED_EMAILS`; e-mail precisa estar verificado; sessão de 8 h |
| Conta Google comprometida | Ativar verificação em duas etapas (ou passkey) na conta Google — **obrigatório** |
| Vazamento das chaves da Pluggy | Chaves só em variáveis de ambiente do servidor; `server-only` impede importar em código de cliente; `.env*` no `.gitignore` |
| Navegador obtém acesso a dados bancários | O navegador só recebe o *connect token* (≈30 min, sem acesso a dados) |
| Webhook falso | Ver 3.3 |
| CSRF em rotas que alteram estado | Cookies `SameSite=Lax` (Auth.js) + checagem de `Origin` nas rotas POST |
| Clickjacking / injeção | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, CSP completa na Fase 1 |
| Dependência vulnerável | `npm audit` no CI + Dependabot semanal |
| Vazamento por logs | Logs registram só o tipo de erro, nunca tokens, valores ou payloads completos |
| Perda de dados | Backups e restauração pontual do Neon **[verificar retenção no plano escolhido]** |

### 3.2 Autenticação e autorização em camadas

1. **Proxy** (`src/proxy.ts`): checagem rápida do cookie em toda rota. Sem sessão → página vai para `/login`; API recebe `401`.
2. **Cada página e rota** chama `auth()` de novo antes de tocar em dados (recomendação do guia de autenticação do Next.js: o proxy não deve ser a única barreira).
3. **Cada consulta ao banco** filtra pelo `user_id` do usuário logado.

### 3.3 Webhook da Pluggy

A skill de integração da Pluggy não descreve assinatura nos webhooks
**[verificar na documentação oficial se existe]**. Por isso:

- A URL do webhook contém um **segredo longo e aleatório** no caminho, comparado em tempo constante.
- O payload é tratado só como **aviso**: o app nunca grava dados vindos do webhook; ele busca tudo de novo na API da Pluggy com a própria chave.
- `eventId` com índice único → avisos repetidos são ignorados (idempotência).
- Responde em até 5 s e processa depois, como a Pluggy recomenda.
- Se a Pluggy publicar faixas de IP fixas, filtrar por IP **[verificar]**.

### 3.4 Dados e privacidade

- Dinheiro em `numeric(14,2)`, lido como string — nunca `float`.
- O e-mail **não** é enviado à Pluggy: o `clientUserId` é um HMAC do e-mail.
- Remover uma conexão: apaga o item na Pluggy e, por `ON DELETE CASCADE`, contas, transações e investimentos locais.
- Trilha de auditoria (`audit_log`) para conectar/remover banco e exportar dados.
- Neon criptografa os dados em repouso **[verificar]**; conexões sempre com TLS (`sslmode=require`).

### 3.5 Headers HTTP

Já ativos: HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy`, CSP parcial (`frame-ancestors`, `base-uri`, `form-action`).
Fase 1: CSP completa com `script-src`/`frame-src`/`connect-src` restritos aos
domínios do widget da Pluggy.

## 4. Fluxos principais

### 4.1 Login
1. `/login` → "Entrar com Google" (server action `signIn("google")`).
2. Google autentica (com 2º fator) e volta para `/api/auth/callback/google`.
3. Callback `signIn` aceita só e-mail verificado e presente em `ALLOWED_EMAILS`.
4. Sessão JWT criptografada em cookie `HttpOnly`, `Secure`, `SameSite=Lax`, 8 h.

### 4.2 Conectar um banco (Fase 1)
1. Navegador → `POST /api/pluggy/connect-token` (exige sessão e mesma origem).
2. Servidor cria o token com `createConnectToken(undefined, { clientUserId, webhookUrl, avoidDuplicates })`.
   *Atenção:* no `pluggy-sdk` 0.94 o 1º parâmetro é o `itemId`; as opções vão no 2º.
3. Widget Pluggy Connect abre no navegador com esse token; você autoriza no banco.
4. `onSuccess` devolve o `itemId` → `POST /api/pluggy/items` grava a conexão.
5. Pluggy sincroniza e envia `item/created`/`item/updated` ao webhook.

### 4.3 Sincronização (Fase 1)
- `item/created|updated` → buscar contas e investimentos do item e fazer *upsert*.
- `transactions/created` → buscar pelo `createdTransactionsLink`.
- `transactions/updated|deleted` → atualizar/apagar pelos `transactionIds`.
- `item/error|waiting_user_input` → marcar a conexão e mostrar aviso no painel.
- `item/deleted` → apagar dados locais.
- Paginação sempre (regra `data-pagination` da skill).
- Botão "Atualizar agora" com limite de frequência (evita custo e bloqueio).

## 5. Modelo de dados

Definido em `src/db/schema.ts`:

| Tabela | Conteúdo | Chave de idempotência |
|---|---|---|
| `users` | E-mails autorizados | `email` |
| `connections` | Bancos conectados (items Pluggy) | `pluggy_item_id` |
| `accounts` | Contas e cartões, saldo, limite | `pluggy_account_id` |
| `categories` | Categorias próprias | `(user_id, name)` |
| `transactions` | Movimentações; categoria Pluggy + categoria própria | `pluggy_transaction_id` |
| `investments` | Posições | `pluggy_investment_id` |
| `budgets` | Limite por categoria e mês | `(user_id, category_id, month)` |
| `webhook_events` | Avisos recebidos | `event_id` |
| `audit_log` | Ações sensíveis | — |

Migrações: `npm run db:generate` (gera SQL para revisão) → `npm run db:migrate`
(usa a connection string **direta**). Testar migrações num *branch* do Neon antes de produção.

## 6. Organização do código

```
src/
  app/
    page.tsx                         painel (protegido)
    login/page.tsx                   login com Google
    api/auth/[...nextauth]/route.ts  rotas do Auth.js
    api/pluggy/connect-token/        cria connect token
    api/webhooks/pluggy/[secret]/    (Fase 1) recebe avisos
  auth.ts                            configuração do Auth.js
  proxy.ts                           checagem de sessão em todas as rotas
  db/schema.ts, db/index.ts          Drizzle + conexão
  lib/env.ts                         variáveis de ambiente validadas
  lib/pluggy.ts                      cliente Pluggy (só servidor)
  lib/session.ts                     helpers de sessão e origem
docs/                                arquitetura e plano
.claude/skills/                      skills de referência para o Claude
```

## 7. Ambientes e operação

| Ambiente | Pluggy | Banco | Login |
|---|---|---|---|
| Local | Sandbox (`user-ok` / `password-ok`) | Branch de dev do Neon | Google (localhost como redirect) |
| Preview (PR) | Sandbox | Branch do Neon por PR **[opcional]** | Google |
| Produção | Credenciais reais | Branch principal do Neon | Google |

- **Segredos:** variáveis de ambiente da Vercel, separadas por ambiente.
- **CI:** lint, typecheck, build e `npm audit` em todo PR.
- **Observabilidade:** logs da Vercel sem dados sensíveis; status das conexões no painel.
- **Backups:** restauração pontual do Neon; exportação CSV manual pelo app (Fase 5).

## 8. Riscos e pontos em aberto

| Ponto | Situação |
|---|---|
| Preço da Pluggy e se o sandbox é gratuito | **[verificar]** no site/painel da Pluggy |
| Assinatura de webhook da Pluggy | **[verificar]**; mitigado pelo desenho da seção 3.3 |
| Limites dos planos gratuitos de Vercel e Neon | **[verificar]** antes da produção |
| `next-auth` v5 ainda em beta | Acompanhar releases; Dependabot ajuda |
| Next.js 16 mudou convenções (ex.: `middleware` → `proxy`) | Seguir `node_modules/next/dist/docs/` |
