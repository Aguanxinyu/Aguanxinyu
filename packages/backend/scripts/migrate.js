import console from 'node:console';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Pool } = pg;

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    console.error(
      'DATABASE_URL 未设置。请在 .env 中配置 postgres://... 后运行 npm run db:migrate。'
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL);'
    );
    const applied = new Set(
      (await client.query('SELECT version FROM schema_migrations;')).rows.map((r) => r.version)
    );
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN;');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2);', [
          file,
          Date.now()
        ]);
        await client.query('COMMIT;');
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK;');
        throw error;
      }
    }
    console.log('migrations up to date');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('迁移失败:', error);
  process.exit(1);
});
