import { writesPaused } from "./availability.mjs";
import { seedStores, validateStore } from "../src/store-domain.ts";
import { correctStorePoint } from "./reference-migration.mjs";
import { eventNames, cleanProperties } from "../src/telemetry-schema.ts";
export async function communityRoute(
  req,
  env,
  scope,
  { isQA, rate, body, output },
) {
  const url = new URL(req.url),
    path = url.pathname;
  if (path === "/api/community/qa" && req.method === "DELETE") {
    if (!isQA) return output({ error: "未授权。" }, 403);
    await env.DB.batch(
      [
        "comments",
        "analytics_events",
        "stores",
        "cached_pois",
        "cache_runs",
      ].map((t) =>
        env.DB.prepare(`DELETE FROM ${t} WHERE scope=?`).bind(scope),
      ),
    );
    return output({ ok: true });
  }
  if (path === "/api/community/stores") {
    if (req.method === "GET") {
      if (scope === "public") {
        const missing = [];
        for (const s of seedStores)
          if (
            !(await env.DB.prepare(
              "SELECT id FROM stores WHERE scope=? AND id=?",
            )
              .bind(scope, s.id)
              .first())
          )
            missing.push(s);
        if (missing.length && !writesPaused(env))
          await env.DB.batch(
            missing.map((s) =>
              env.DB.prepare(
                "INSERT OR IGNORE INTO stores(scope,id,record,created_at) VALUES(?,?,?,?)",
              ).bind(scope, s.id, JSON.stringify(s), s.createdAt),
            ),
          );
        if (!writesPaused(env)) await correctStorePoint(env);
      }
      const rows = await env.DB.prepare(
        "SELECT record FROM stores WHERE scope=? ORDER BY created_at DESC LIMIT 1000",
      )
        .bind(scope)
        .all();
      return output({ stores: rows.results.map((r) => JSON.parse(r.record)) });
    }
    if (req.method === "POST") {
      if (!(await rate(req, env, scope, 20, "community")))
        return output({ error: "标记较频繁，请稍后重试。" }, 429);
      const raw = await body(req),
        input = {
          name: raw.name,
          category: raw.category,
          address: raw.address,
          location: raw.location,
        },
        issue = validateStore(input);
      if (issue) return output({ error: issue }, 400);
      const store = {
        ...input,
        name: input.name.trim(),
        address: input.address.trim(),
        id: crypto.randomUUID(),
        tags: [],
        source: "community",
        locationPrecision: "poi",
        createdAt: new Date().toISOString(),
      };
      await env.DB.prepare(
        "INSERT INTO stores(scope,id,record,created_at) VALUES(?,?,?,?)",
      )
        .bind(scope, store.id, JSON.stringify(store), store.createdAt)
        .run();
      return output({ store }, 201);
    }
  }
  if (path === "/api/community/comments") {
    if (req.method === "GET") {
      const store = url.searchParams.get("store") || "";
      if (!/^[\w\-\u4e00-\u9fff]{1,160}$/.test(store))
        return output({ error: "请选择门店。" }, 400);
      const rows = await env.DB.prepare(
        "SELECT id,store_id AS storeId,parent_id AS parentId,root_id AS rootId,content,created_at AS createdAt FROM comments WHERE scope=? AND store_id=? ORDER BY created_at DESC LIMIT 300",
      )
        .bind(scope, store)
        .all();
      return output({ comments: rows.results });
    }
    if (req.method === "POST") {
      if (!(await rate(req, env, scope, 20, "community")))
        return output({ error: "分享较频繁，请稍后重试。" }, 429);
      const input = await body(req),
        store = typeof input.storeId === "string" ? input.storeId : "",
        content = typeof input.content === "string" ? input.content.trim() : "";
      if (
        !/^[\w\-\u4e00-\u9fff]{1,160}$/.test(store) ||
        !content ||
        content.length > 500
      )
        return output({ error: "请选择门店，并写一句话（最多500字）。" }, 400);
      let parent = null;
      if (input.parentId) {
        parent = await env.DB.prepare(
          "SELECT id,root_id,store_id FROM comments WHERE scope=? AND id=?",
        )
          .bind(scope, String(input.parentId))
          .first();
        if (!parent || parent.store_id !== store)
          return output({ error: "原评论不存在或不属于此门店。" }, 404);
      }
      const id = crypto.randomUUID(),
        createdAt = new Date().toISOString(),
        rootId = parent ? parent.root_id || parent.id : id;
      await env.DB.prepare(
        "INSERT INTO comments(scope,id,store_id,parent_id,root_id,content,created_at) VALUES(?,?,?,?,?,?,?)",
      )
        .bind(scope, id, store, parent?.id || null, rootId, content, createdAt)
        .run();
      return output(
        {
          comment: {
            id,
            storeId: store,
            parentId: parent?.id || null,
            rootId,
            content,
            createdAt,
          },
        },
        201,
      );
    }
  }
  if (path === "/api/analytics/events" && req.method === "POST") {
    if (!(await rate(req, env, scope, 120, "analytics")))
      return output({ error: "请求较频繁。" }, 429);
    const input = await body(req);
    if (
      !/^[a-f0-9-]{36}$/.test(input.session || "") ||
      !Array.isArray(input.events) ||
      input.events.length > 24
    )
      return output({ error: "无效事件。" }, 400);
    const now = new Date().toISOString(),
      eventScope =
        scope === "public" && url.hostname === "127.0.0.1"
          ? "development"
          : scope;
    const statements = [];
    for (const e of input.events) {
      if (
        !eventNames.includes(e.name) ||
        !["home", "water"].includes(e.page) ||
        !/^[a-f0-9-]{36}$/.test(e.id || "")
      )
        continue;
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO analytics_events(scope,id,session_id,page,name,properties,created_at) VALUES(?,?,?,?,?,?,?)",
        ).bind(
          eventScope,
          e.id,
          input.session,
          e.page,
          e.name,
          JSON.stringify(cleanProperties(e.properties)),
          now,
        ),
      );
    }
    if (statements.length) await env.DB.batch(statements);
    await env.DB.prepare("DELETE FROM analytics_events WHERE created_at<?")
      .bind(new Date(Date.now() - 30 * 86400000).toISOString())
      .run();
    return output({ accepted: statements.length });
  }
  if (path === "/api/analytics/stats" && req.method === "GET") {
    if (
      !env.ANALYTICS_TOKEN ||
      req.headers.get("authorization") !== `Bearer ${env.ANALYTICS_TOKEN}`
    )
      return output({ error: "需要统计访问凭据。" }, 403);
    const days = Math.min(
        30,
        Math.max(1, Number(url.searchParams.get("days")) || 7),
      ),
      since = new Date(Date.now() - days * 86400000).toISOString();
    const summary = await env.DB.prepare(
      "SELECT COUNT(*) AS events,COUNT(DISTINCT session_id) AS sessions,SUM(CASE WHEN name='page_view' THEN 1 ELSE 0 END) AS pageViews FROM analytics_events WHERE scope=? AND created_at>=?",
    )
      .bind(scope, since)
      .first();
    const events = await env.DB.prepare(
      "SELECT page,name,COUNT(*) AS count FROM analytics_events WHERE scope=? AND created_at>=? GROUP BY page,name ORDER BY count DESC",
    )
      .bind(scope, since)
      .all();
    const daily = await env.DB.prepare(
      "SELECT substr(created_at,1,10) AS day,COUNT(*) AS events,COUNT(DISTINCT session_id) AS sessions FROM analytics_events WHERE scope=? AND created_at>=? GROUP BY day ORDER BY day",
    )
      .bind(scope, since)
      .all();
    const dimensions = await env.DB.prepare(
      "SELECT name,properties,COUNT(*) AS count FROM analytics_events WHERE scope=? AND created_at>=? GROUP BY name,properties ORDER BY count DESC LIMIT 100",
    )
      .bind(scope, since)
      .all();
    return output({
      days,
      retentionDays: 30,
      summary,
      events: events.results,
      daily: daily.results,
      dimensions: dimensions.results.map((d) => ({
        ...d,
        properties: JSON.parse(d.properties),
      })),
    });
  }
  return output({ error: "接口不存在。" }, 404);
}
