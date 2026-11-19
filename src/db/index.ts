import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getServerEnv } from "@/lib/env";
import * as schema from "./schema";

let db: NodePgDatabase<typeof schema> | undefined;

/**
 * Conexão com o Postgres (Neon), criada sob demanda.
 * Use a connection string *pooled* (com "-pooler") em DATABASE_URL.
 * Na Vercel, attachDatabasePool fecha conexões ociosas corretamente.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (db) return db;
  const { DATABASE_URL } = getServerEnv();
  if (!DATABASE_URL) throw new Error("DATABASE_URL não configurada");
  const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  attachDatabasePool(pool);
  db = drizzle({ client: pool, schema });
  return db;
}
