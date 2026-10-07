import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function createWaterDB(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec(readFileSync(path.join(root, "worker/schema.sql"), "utf8"));
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
        const result = db.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      _execute() {
        const result = db.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
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
let localDB;
export function getWaterDB() {
  if (!localDB) {
    mkdirSync(path.join(root, ".data"), { recursive: true });
    localDB = createWaterDB(path.join(root, ".data", "water.sqlite"));
  }
  return localDB;
}
