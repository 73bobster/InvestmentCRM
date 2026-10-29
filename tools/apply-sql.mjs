// Applies SQL files to the Neon database in one transaction.
//   DATABASE_URL="postgres://..." node tools/apply-sql.mjs migrations/0001_core.sql migrations/0002_crm.sql migrations/0003_demo_support.sql
// Needs:  npm install @neondatabase/serverless   (the connection string is a secret: never commit it)
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { splitSql } from '../tests/split-sql.mjs';
const sql = neon(process.env.DATABASE_URL);
const stmts = process.argv.slice(2).flatMap((f) => splitSql(readFileSync(f, 'utf8')));
console.log(`${stmts.length} statements`);
await sql.transaction(stmts.map((s) => sql.query(s)));
console.log('applied');
