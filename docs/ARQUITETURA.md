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
| Clickjacking / injeção | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, CSP completa (seção 3.5) |
| Navegador manda `itemId` de outra pessoa | `POST /api/pluggy/items` confere na Pluggy se o item tem o **seu** `clientUserId` |
| Abuso do "Sincronizar agora" | Intervalo mínimo de 5 min por conexão |
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
- Neon criptografa os dados em repouso **[verificar]**; conexões sempre com TLS e
  verificação do certificado: `src/db/url.ts` converte `sslmode=require` em
  `sslmode=verify-full` (o `pg` v9 vai enfraquecer o significado de `require`).

### 3.5 Headers HTTP

Ativos: HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy` e CSP completa (`next.config.ts`):

- `default-src 'self'`; `connect-src 'self'`; `object-src 'none'`
- `frame-src https://connect.pluggy.ai` (único iframe permitido: o widget)
- `form-action 'self' https://accounts.google.com` (login)
- `script-src`/`style-src` com `'unsafe-inline'`: abordagem "sem nonce" do guia
  de CSP do Next 16, compatível com páginas estáticas; o widget também injeta
  `<style>`. Melhoria futura possível: CSP com nonce (exige renderização dinâmica).

## 4. Fluxos principais

### 4.1 Login
1. `/login` → "Entrar com Google" (server action `signIn("google")`).
2. Google autentica (com 2º fator) e volta para `/api/auth/callback/google`.
3. Callback `signIn` aceita só e-mail verificado e presente em `ALLOWED_EMAILS`.
4. Sessão JWT criptografada em cookie `HttpOnly`, `Secure`, `SameSite=Lax`, 8 h.

### 4.2 Conectar um banco
1. Botão "Conectar banco" (`src/app/components/ConnectBank.tsx`) → `POST /api/pluggy/connect-token` (exige sessão e mesma origem).
2. Servidor cria o token com `createConnectToken(itemId?, { clientUserId, webhookUrl, avoidDuplicates })`.
   *Atenção:* no `pluggy-sdk` 0.94 o 1º parâmetro é o `itemId` (só para **reconectar**); as opções vão no 2º.
   `webhookUrl` = `APP_URL` + `/api/webhooks/pluggy/` + `PLUGGY_WEBHOOK_SECRET` (só se `APP_URL` for HTTPS).
3. Widget Pluggy Connect abre (iframe de `connect.pluggy.ai`); você autoriza no banco.
4. `onSuccess` devolve o `itemId` → `POST /api/pluggy/items`, que **confere na Pluggy** que o item tem o seu `clientUserId`, grava a conexão e agenda a 1ª sincronização com `after()`.
5. A Pluggy envia avisos ao webhook quando há dados novos.
6. **Reconectar** (senha mudou, MFA): o painel mostra "Reconectar" e o widget abre com `updateItem`.

### 4.3 Sincronização (`src/lib/sync.ts`)
Desenho escolhido: **qualquer** aviso de um item conhecido dispara uma
ressincronização completa a partir da API. O conteúdo do aviso só serve para
saber *qual* item atualizar — nunca como dado.

1. `fetchItem` → atualiza status. Se 404 → apaga a conexão local (cascade).
2. Se o status não for `UPDATED`, para aqui (dados ainda incompletos).
3. Contas: `fetchAccounts` → *upsert*; contas que sumiram são apagadas.
4. Transações: `fetchAllTransactions(accountId, { dateFrom })` (cursor; o método
   por páginas está obsoleto no SDK) dos últimos **365 dias** → *upsert* em lotes;
   transações da janela que sumiram na Pluggy são apagadas. A **categoria
   escolhida por você** (`category_id`) nunca é sobrescrita.
5. Investimentos: `fetchInvestments` paginado → *upsert*; os que sumiram são apagados.
6. Sinal do valor vem do `type` (DEBIT negativo, CREDIT positivo), não do sinal
   original, que varia entre conta e cartão.
7. "Sincronizar agora" no painel, com intervalo mínimo de 5 min.

Webhook (`/api/webhooks/pluggy/[secret]`): segredo errado → 404; corpo validado
com zod; `event_id` único (avisos repetidos ignorados); resposta imediata e
processamento com `after()`; só `event`, `eventId` e `itemId` são guardados.

**Testado localmente** com Postgres e uma Pluggy simulada: criação, atualização,
remoção de contas/transações, preservação da categoria própria, item apagado,
segredo errado, JSON inválido e aviso repetido.

### 4.4 Desconectar um banco
`removerConexao` (Server Action): confere o dono → `deleteItem` na Pluggy
(revoga o acesso e apaga os dados de lá) → apaga os dados locais (cascade) →
registra em `audit_log`. Se a Pluggy falhar, nada é apagado localmente.

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

Migrações: `npm run db:generate` (gera SQL em `drizzle/` para revisão) →
commit → ao chegar no `main`, o workflow **"Migrações do banco"**
(`.github/workflows/db-migrate.yml`) roda `npm run db:migrate` com o segredo
`DATABASE_URL_UNPOOLED` do GitHub (connection string **direta**). Também pode
ser disparado manualmente na aba Actions. Migrações grandes: testar antes num
*branch* do Neon.

## 6. Organização do código

```
src/
  app/
    page.tsx                         painel (protegido)
    login/page.tsx                   login com Google
    api/auth/[...nextauth]/route.ts  rotas do Auth.js
    api/pluggy/connect-token/        cria connect token
    api/pluggy/items/                registra banco conectado
    api/webhooks/pluggy/[secret]/    recebe avisos da Pluggy
    actions.ts                       sincronizar / desconectar (Server Actions)
    components/                      ConnectBank (widget), ConnectionActions
  auth.ts                            configuração do Auth.js
  proxy.ts                           checagem de sessão em todas as rotas
  db/schema.ts, db/index.ts          Drizzle + conexão
  lib/env.ts                         variáveis de ambiente validadas
  lib/pluggy.ts                      cliente Pluggy (só servidor)
  lib/session.ts                     helpers de sessão, origem e leitura de JSON
  lib/sync.ts                        sincronização com a Pluggy
  lib/money.ts                       conversão/formatação de dinheiro
  lib/users.ts, lib/connections.ts   usuário, auditoria, posse de conexões
drizzle/                             migrações SQL geradas
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
| Formato do erro 404 da Pluggy (`isPluggyNotFound`) | **[verificar]** com o sandbox; hoje aceita `code`/`statusCode`/`status` = 404 |
| Sincronização longa (muitas transações) | Limite de 60 s por função; se estourar, dividir por conta |
| Limites dos planos gratuitos de Vercel e Neon | **[verificar]** antes da produção |
| `next-auth` v5 ainda em beta | Acompanhar releases; Dependabot ajuda |
| Next.js 16 mudou convenções (ex.: `middleware` → `proxy`) | Seguir `node_modules/next/dist/docs/` |
