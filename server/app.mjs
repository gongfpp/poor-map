import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import waterWorker from "../worker/index.mjs";
import { getWaterDB } from "./water-db.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const groups = [
  ["discount", "赵一鸣零食|零食很忙|零食有鸣|好特卖|嗨特购|奥特乐"],
  ["mixue", "蜜雪冰城"],
];
const str = (value) => (typeof value === "string" ? value : "");
export function createApp({ env = process.env, upstream = fetch } = {}) {
  const app = express(),
    cache = new Map(),
    limits = new Map();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use(["/api", "/_AMapService"], (req, res, next) => {
    if (
      env.QA_TOKEN &&
      /^\/api\/(water|community|analytics|discovery|navigation)/.test(
        req.originalUrl,
      ) &&
      req.get("X-QA-Token") === env.QA_TOKEN
    ) {
      next();
      return;
    }
    const now = Date.now(),
      key = req.ip,
      entry = limits.get(key);
    if (!entry || now - entry.start > 60000)
      limits.set(key, { start: now, count: 1 });
    else if (++entry.count > 90)
      return res.status(429).json({ error: "请求较频繁，请稍后重试。" });
    if (limits.size > 1000)
      for (const [ip, item] of limits)
        if (now - item.start > 60000) limits.delete(ip);
    res.set("Cache-Control", "no-store");
    next();
  });
  const waterGuard = randomUUID();
  app.use(
    [
      "/api/water",
      "/api/community",
      "/api/analytics",
      "/api/discovery",
      "/api/navigation",
    ],
    async (req, res) => {
      try {
        const chunks = [];
        let bytes = 0;
        const maxBytes =
          req.originalUrl.startsWith("/api/discovery/import") &&
          env.DATA_ADMIN_TOKEN &&
          req.get("authorization") === `Bearer ${env.DATA_ADMIN_TOKEN}`
            ? 350000
            : 8192;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            res.status(413).json({ error: "内容过长。" });
            return;
          }
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks).toString("utf8");
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (typeof value === "string") headers.set(key, value);
        headers.set("cf-connecting-ip", req.ip || "local");
        const request = new Request("http://127.0.0.1" + req.originalUrl, {
          method: req.method,
          headers,
          ...(!["GET", "HEAD"].includes(req.method) && body ? { body } : {}),
        });
        const response = await waterWorker.fetch(request, {
          ...env,
          DB: getWaterDB(),
          QA_TOKEN: env.QA_TOKEN || waterGuard,
          STORAGE_KIND: "SQLite",
          BAIDU_MD5: (bytes) => createHash("md5").update(bytes).digest(),
        });
        response.headers.forEach((v, k) => res.set(k, v));
        res
          .status(response.status)
          .send(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.status(503).json({ error: "水价服务暂时不可用。" });
      }
    },
  );
  const get = async (endpoint, params) => {
    const url = new URL(`https://restapi.amap.com${endpoint}`);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, String(value));
    url.searchParams.set("key", env.AMAP_WEB_SERVICE_KEY);
    const response = await upstream(url, {
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("地图服务暂时不可用，请稍后重试。");
    const data = await response.json();
    if (data.status !== "1")
      throw new Error(
        `高德查询失败（${String(data.infocode || "unknown")}），请检查密钥权限或配额。`,
      );
    return data;
  };
  app.get("/api/config", (req, res) =>
    res.json({
      provider: env.TIANDITU_WEB_KEY ? "tianditu" : "amap",
      jsKey: env.TIANDITU_WEB_KEY || env.AMAP_JS_KEY || "",
      mapReady:
        !!env.TIANDITU_WEB_KEY ||
        !!(env.AMAP_JS_KEY && env.AMAP_JS_SECURITY_CODE),
      searchReady: !!env.AMAP_WEB_SERVICE_KEY,
      providers: [
        {
          name: "高德地图",
          status: env.AMAP_WEB_SERVICE_KEY ? "configured" : "missing",
        },
        { name: "美团 / 大众点评", status: "not-connected" },
        { name: "抖音生活服务", status: "not-connected" },
      ],
    }),
  );
  app.get("/api/nearby", async (req, res) => {
    if (!env.AMAP_WEB_SERVICE_KEY)
      return res.status(503).json({
        error: "尚未配置高德 Web 服务 Key。请在本地 .env 中配置后重启。",
      });
    const center = str(req.query.center).split(",").map(Number),
      radius = Number(req.query.radius || 3000),
      category = str(req.query.category) || "all";
    if (
      center.length !== 2 ||
      !center.every(Number.isFinite) ||
      center[0] < 72.004 ||
      center[0] > 137.8347 ||
      center[1] < 0.8293 ||
      center[1] > 55.8271 ||
      !Number.isInteger(radius) ||
      radius < 100 ||
      radius > 10000 ||
      !(category === "all" || groups.some((g) => g[0] === category))
    )
      return res
        .status(400)
        .json({ error: "请提供有效的大陆区域坐标、100–10000 米半径和分类。" });
    const rounded = center.map((n) => n.toFixed(6)).join(","),
      key = `${rounded}:${radius}:${category}`,
      previous = cache.get(key);
    if (previous && Date.now() - previous.time < 300000)
      return res.json({ ...previous.data, cached: true });
    const requested =
      category === "all" ? groups : groups.filter((g) => g[0] === category);
    const results = await Promise.allSettled(
      requested.map(async ([cat, keywords]) => {
        const data = await get("/v3/place/around", {
          location: rounded,
          keywords,
          radius,
          sortrule: "distance",
          offset: 25,
          page: 1,
          extensions: "base",
        });
        return { cat, count: Number(data.count) || 0, pois: data.pois || [] };
      }),
    );
    const stores = new Map(),
      warnings = [];
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        warnings.push(`${requested[i][0]}：${result.reason.message}`);
        return;
      }
      const { cat, count, pois } = result.value;
      if (count > pois.length)
        warnings.push(
          `${cat} 仅展示首批 ${pois.length} 家，共检索到 ${count} 家；可缩小半径或切换分类。`,
        );
      for (const poi of pois) {
        const location = str(poi.location).split(",").map(Number);
        if (
          location.length !== 2 ||
          !location.every(Number.isFinite) ||
          !poi.id
        )
          continue;
        if (!stores.has(poi.id))
          stores.set(poi.id, {
            id: poi.id,
            name: str(poi.name),
            category: cat,
            address: [poi.pname, poi.cityname, poi.adname, poi.address]
              .filter((v) => typeof v === "string")
              .join(" "),
            location,
            tags: ["价格待确认", "高德门店线索"],
            source: "amap",
          });
      }
    });
    if (results.every((r) => r.status === "rejected"))
      return res
        .status(502)
        .json({ error: "周边查询未成功。" + warnings.join(" ") });
    const data = {
      stores: [...stores.values()],
      warnings,
      queriedAt: new Date().toISOString(),
      source: "amap",
      partial: warnings.length > 0,
    };
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { time: Date.now(), data });
    res.json(data);
  });
  app.get("/api/center", async (req, res) => {
    if (!env.AMAP_WEB_SERVICE_KEY)
      return res.status(503).json({ error: "地点搜索需要高德 Web 服务 Key。" });
    const query = str(req.query.query).trim();
    if (query.length < 2 || query.length > 80)
      return res.status(400).json({ error: "请输入 2–80 字的城市或地址。" });
    try {
      const data = await get("/v3/geocode/geo", { address: query });
      const item = data.geocodes?.[0];
      if (!item)
        return res
          .status(404)
          .json({ error: "没有找到该地点，请补充城市和街道。" });
      res.json({
        center: item.location.split(",").map(Number),
        label: item.formatted_address,
      });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });
  app.use("/_AMapService", async (req, res) => {
    if (!env.AMAP_JS_SECURITY_CODE)
      return res.status(503).json({ error: "高德 JS 安全密钥未配置。" });
    const pathname = req.path;
    if (
      !/^\/v[345]\/(place\/(around|text|detail)|geocode\/(geo|regeo)|assistant\/inputtips|config\/district|map\/styles|log\/init)\/?$/.test(
        pathname,
      )
    )
      return res.status(403).json({ error: "此代理路径未开放。" });
    const host = pathname.startsWith("/v4/map/styles")
      ? "webapi.amap.com"
      : "restapi.amap.com";
    const url = new URL(
      req.originalUrl.replace(/^\/_AMapService/, ""),
      `https://${host}`,
    );
    url.searchParams.set("jscode", env.AMAP_JS_SECURITY_CODE);
    url.searchParams.set("key", env.AMAP_JS_KEY);
    try {
      const response = await upstream(url, {
        signal: AbortSignal.timeout(12000),
      });
      res
        .status(response.status)
        .set(
          "Content-Type",
          response.headers.get("content-type") || "application/json",
        )
        .send(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.status(502).json({ error: "地图 SDK 代理暂时不可用。" });
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "接口不存在。" }),
  );
  app.use(express.static(path.join(root, "dist")));
  app.use((req, res) => {
    if (req.method === "GET" && !path.extname(req.path))
      res.sendFile(path.join(root, "dist/index.html"));
    else res.status(404).end();
  });
  return app;
}
