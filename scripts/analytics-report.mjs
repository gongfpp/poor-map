import { readFileSync } from "node:fs";
import { parse } from "dotenv";
const token =
  process.env.ANALYTICS_TOKEN ||
  parse(readFileSync(".env", "utf8")).ANALYTICS_TOKEN;
if (!token) throw new Error("ANALYTICS_TOKEN is required in ignored .env.");
const url = new URL(
  "/api/analytics/stats",
  process.argv[2] || "https://poor-map-api.gong7968.workers.dev",
);
url.searchParams.set("days", process.argv[3] || "7");
const r = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(15000),
});
if (!r.ok) throw new Error(`Statistics unavailable (${r.status}).`);
console.log(JSON.stringify(await r.json(), null, 2));
