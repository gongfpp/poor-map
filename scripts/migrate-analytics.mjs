// Re-run after cutover to capture the final D1 tail, compare every row, then retire
// the copied public rows only when explicitly requested with --retire-source.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { cleanProperties } from "../src/telemetry-schema.ts";
const host = process.env.ANALYTICS_SSH_HOST || "ubuntu@212.64.11.71";
const runSQL = (sql) =>
  JSON.parse(
    execFileSync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        "poor-map-water",
        "--remote",
        "--json",
        "--command",
        sql,
      ],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    ),
  ).flatMap((x) => x.results || []);
const snapshot = new Date().toISOString(),
  since = new Date(Date.now() - 30 * 86400000).toISOString();
const rows = runSQL(
  `SELECT scope,id,session_id,page,name,properties,created_at FROM analytics_events WHERE scope='public' AND created_at>='${since}' AND created_at<='${snapshot}'`,
);
const out = execFileSync(
  "ssh",
  [
    "-o",
    "BatchMode=yes",
    host,
    "sudo -u poor-map-analytics /usr/bin/node --experimental-strip-types /opt/poor-map-analytics/current/analytics/import.mjs",
  ],
  {
    input: JSON.stringify(rows),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  },
);
const imported = JSON.parse(out);
assert.equal(imported.valid, rows.length);
const remote = JSON.parse(
  execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      host,
      `sudo -u poor-map-analytics python3 -c 'import sqlite3,json; db=sqlite3.connect("file:/var/lib/poor-map-analytics/events.sqlite?mode=ro",uri=True); db.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in db.execute("SELECT * FROM analytics_events WHERE scope=?",("public",))]))'`,
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  ),
);
const byId = new Map(remote.map((r) => [r.id, r]));
const canonical = (r) =>
  JSON.stringify([
    r.scope,
    r.id,
    r.session_id,
    r.page,
    r.name,
    Object.entries(cleanProperties(JSON.parse(r.properties))).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
    r.created_at,
  ]);
for (const row of rows) {
  assert.ok(byId.has(row.id));
  assert.equal(canonical(byId.get(row.id)), canonical(row));
}
const hash = createHash("sha256")
  .update(rows.map(canonical).sort().join("\n"))
  .digest("hex");
if (process.argv.includes("--retire-source"))
  runSQL(
    `DELETE FROM analytics_events WHERE scope='public' AND created_at<='${snapshot}'`,
  );
console.log(
  JSON.stringify({
    snapshot,
    imported,
    verifiedRows: rows.length,
    sha256: hash,
    sourceRetired: process.argv.includes("--retire-source"),
  }),
);
