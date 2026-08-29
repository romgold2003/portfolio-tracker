/**
 * A SQLite driver that satisfies the same interface as the Postgres one, so the
 * API can be tested without a database to install or a cloud account to create.
 *
 * The only translation needed is placeholder style — $1 to ?1 — which is the
 * measure of how portable the queries are. If this file ever has to grow a
 * special case for a real difference in SQL, the tests have stopped being
 * evidence about production and the query should be rewritten instead.
 */
import { DatabaseSync } from 'node:sqlite';

export function sqliteDriver() {
  const db = new DatabaseSync(':memory:');
  return {
    async query(text, params = []) {
      const sql = text.replace(/\$(\d+)/g, '?$1');
      const statement = db.prepare(sql);
      const bound = params.map((p) => (p === undefined ? null : p));
      // RETURNING makes a write produce rows, and the vault's conflict check
      // depends on getting them back.
      if (/^\s*(SELECT|WITH)/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        return { rows: statement.all(...bound) };
      }
      const info = statement.run(...bound);
      return { rows: [], rowCount: Number(info.changes ?? 0) };
    },
    close() { db.close(); },
  };
}
