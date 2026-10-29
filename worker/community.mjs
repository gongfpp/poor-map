import { writesPaused } from "./availability.mjs";
import { seedStores, validateStore } from "../src/store-domain.ts";
import { correctStorePoint } from "./reference-migration.mjs";
import { analyticsRoute } from "./analytics.mjs";
export async function communityRoute(
  req,
  env,
  scope,
  { isQA, rate, body, output },
) {
  const url = new URL(req.url),
    path = url.pathname;
  if (path.startsWith("/api/analytics/"))
    return analyticsRoute(req, env, scope, { rate, body, output });
  if (path.startsWith("/api/community/stores/") && req.method === "GET") {
    const id = path.slice("/api/community/stores/".length);
    if (!/^[\w-]{1,160}$/.test(id))
      return output({ error: "门店链接无效。" }, 400);
    // 按明确 ID 读取，不做模糊匹配、不调用供应商，也不写入种子。
    const canonical =
      scope === "public" ? seedStores.find((s) => s.amapId === id) : null;
    const shared = await env.DB.prepare(
      "SELECT record FROM stores WHERE scope=? AND id=?",
    )
      .bind(scope, canonical?.id || id)
      .first();
    if (shared) return output({ store: JSON.parse(shared.record) });
    if (scope === "public") {
      const seed = canonical || seedStores.find((s) => s.id === id);
      if (seed) return output({ store: seed });
    }
    const cached = await env.DB.prepare(
      "SELECT record,fetched_at FROM cached_pois WHERE scope=? AND provider IN ('amap','baidu','tencent','tianditu') AND id=? LIMIT 1",
    )
      .bind(scope, id)
      .first();
    if (cached)
      return output({
        store: { ...JSON.parse(cached.record), cachedAt: cached.fetched_at },
      });
    return output(
      { error: "这家门店尚未收录或已无法读取，可返回地图查找。" },
      404,
    );
  }
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
  return output({ error: "接口不存在。" }, 404);
}
