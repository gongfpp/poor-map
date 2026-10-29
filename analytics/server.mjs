import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { analyticsRoute } from "../worker/analytics.mjs";
import { createAnalyticsDB } from "./db.mjs";
const output = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
function same(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    a.length > 0 &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function createCollector(env) {
  const buckets = new Map();
  async function rate(req, _env, scope, maximum) {
    if (scope.startsWith("qa:")) return true;
    const hour = Math.floor(Date.now() / 3600000);
    for (const [key, item] of buckets)
      if (item.hour !== hour) buckets.delete(key);
    const key = req.headers.get("x-analytics-rate");
    if (
      !/^[a-f0-9]{64}$/.test(key || "") ||
      (buckets.size >= 2000 && !buckets.has(key))
    )
      return false;
    const item = buckets.get(key) || { hour, count: 0 };
    item.count++;
    buckets.set(key, item);
    return item.count <= maximum;
  }
  async function body(req) {
    const text = await req.text();
    if (Buffer.byteLength(text) > 8192) throw new SyntaxError("too large");
    const input = JSON.parse(text);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new SyntaxError("object required");
    return input;
  }
  return async function handle(req) {
    const path = new URL(req.url).pathname;
    if (path === "/health" && req.method === "GET") {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return output({ ok: true, storage: "tencent-sqlite", version: "1.0.0" });
    }
    if (!same(req.headers.get("x-analytics-key"), env.ANALYTICS_INGEST_TOKEN))
      return output({ error: "未授权。" }, 403);
    const scope = req.headers.get("x-analytics-scope");
    if (!/^(public|development|qa:[a-zA-Z0-9-]{1,60})$/.test(scope || ""))
      return output({ error: "无效范围。" }, 400);
    if (
      path === "/api/analytics/qa" &&
      req.method === "DELETE" &&
      scope.startsWith("qa:")
    ) {
      await env.DB.prepare("DELETE FROM analytics_events WHERE scope=?")
        .bind(scope)
        .run();
      return output({ ok: true });
    }
    try {
      return await analyticsRoute(
        req,
        { ...env, ANALYTICS_SELF_HOSTED: true },
        scope,
        { rate, body, output },
      );
    } catch (e) {
      return output(
        {
          error:
            e instanceof SyntaxError ? "无效事件。" : "统计服务暂时不可用。",
        },
        e instanceof SyntaxError ? 400 : 503,
      );
    }
  };
}
export function createCollectorServer(env) {
  const handle = createCollector(env);
  return createServer(async (req, res) => {
    try {
      const parts = [];
      let length = 0;
      for await (const part of req) {
        length += part.length;
        if (length > 8192) {
          res.writeHead(413, { Connection: "close" });
          res.end();
          return;
        }
        parts.push(part);
      }
      const response = await handle(
        new Request("http://127.0.0.1" + req.url, {
          method: req.method,
          headers: req.headers,
          ...(["GET", "HEAD"].includes(req.method)
            ? {}
            : { body: Buffer.concat(parts) }),
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end('{"error":"统计服务暂时不可用。"}');
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  if (!process.env.ANALYTICS_TOKEN || !process.env.ANALYTICS_INGEST_TOKEN)
    throw new Error("Analytics credentials required");
  const DB = createAnalyticsDB(
    process.env.ANALYTICS_DB || "/var/lib/poor-map-analytics/events.sqlite",
  );
  const purge = () =>
    DB.prepare("DELETE FROM analytics_events WHERE created_at<?")
      .bind(new Date(Date.now() - 30 * 86400000).toISOString())
      .run();
  await purge();
  const timer = setInterval(
    () => void purge().catch(() => console.error("Retention cleanup failed")),
    3600000,
  );
  timer.unref();
  const server = createCollectorServer({ ...process.env, DB });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 3160), "127.0.0.1", () =>
    console.log("Poor Map analytics listening on loopback"),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      clearInterval(timer);
      server.close(() => {
        DB.close();
        process.exit(0);
      });
    });
}
