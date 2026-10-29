import { DatabaseSync } from "node:sqlite";
export function createAnalyticsDB(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS analytics_events(scope TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT NOT NULL,page TEXT NOT NULL,name TEXT NOT NULL,properties TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(scope,id));
    CREATE INDEX IF NOT EXISTS analytics_time ON analytics_events(scope,created_at);`);
  function prepare(sql, values = []) {
    return {
      bind(...args) {
        return prepare(sql, args);
      },
      async first() {
        return db.prepare(sql).get(...values) || null;
      },
      async all() {
        return { results: db.prepare(sql).all(...values) };
      },
      async run() {
        return this._execute();
      },
      _execute() {
        return {
          meta: { changes: Number(db.prepare(sql).run(...values).changes) },
        };
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((s) => s._execute());
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      db.close();
    },
  };
}
