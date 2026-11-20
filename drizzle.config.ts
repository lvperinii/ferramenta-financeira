import { defineConfig } from "drizzle-kit";
import { withVerifyFullSsl } from "./src/db/url";

// Migrações usam a connection string DIRETA (sem "-pooler"),
// conforme recomendação da Neon. Nunca rode migrações à mão em produção:
// gere com `npm run db:generate`, revise o SQL e aplique com `npm run db:migrate`.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: withVerifyFullSsl(process.env.DATABASE_URL_UNPOOLED ?? ""),
  },
  strict: true,
  verbose: true,
});
