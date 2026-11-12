import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL ?? 'file:./cctv.db';

const client = createClient({ url: databaseUrl });
export const db = drizzle(client, { schema });

/**
 * Aplica las migraciones incluidas en packages/db/migrations.
 * Se ejecuta al arrancar el servidor.
 */
export async function runMigrations() {
  const migrationsFolder = path.resolve(__dirname, '../migrations');
  await migrate(db, { migrationsFolder });
}

export { client };
export * from './schema';
