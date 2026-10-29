// Operational migration: stdin is private D1 rows; never print payloads.
import { createAnalyticsDB } from "./db.mjs";
import { eventNames, cleanProperties } from "../src/telemetry-schema.ts";
let text = "";
for await (const chunk of process.stdin) text += chunk;
const rows = JSON.parse(text),
  DB = createAnalyticsDB(
    process.env.ANALYTICS_DB || "/var/lib/poor-map-analytics/events.sqlite",
  );
const since = new Date(Date.now() - 30 * 86400000).toISOString();
try {
  const valid = rows.filter(
    (r) =>
      r.scope === "public" &&
      /^[a-f0-9-]{36}$/.test(r.id) &&
      /^[a-f0-9-]{36}$/.test(r.session_id) &&
      ["home", "water"].includes(r.page) &&
      eventNames.includes(r.name) &&
      r.created_at >= since &&
      r.created_at <= new Date().toISOString(),
  );
  const results = await DB.batch(
    valid.map((r) =>
      DB.prepare(
        "INSERT OR IGNORE INTO analytics_events(scope,id,session_id,page,name,properties,created_at) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        r.scope,
        r.id,
        r.session_id,
        r.page,
        r.name,
        JSON.stringify(cleanProperties(JSON.parse(r.properties))),
        r.created_at,
      ),
    ),
  );
  console.log(
    JSON.stringify({
      read: rows.length,
      valid: valid.length,
      inserted: results.reduce((n, r) => n + r.meta.changes, 0),
    }),
  );
} finally {
  DB.close();
}
