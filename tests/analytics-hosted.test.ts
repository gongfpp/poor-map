import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.mjs";
import { createAnalyticsDB } from "../analytics/db.mjs";
import {
  createCollector,
  createCollectorServer,
} from "../analytics/server.mjs";
const token = "test-ingest",
  admin = "test-admin";
const data = () => ({
  session: crypto.randomUUID(),
  events: [
    {
      id: crypto.randomUUID(),
      page: "home",
      name: "page_view",
      properties: {
        size: "mobile",
        query: "secret",
        latitude: 29.8,
        content: "private",
      },
    },
  ],
});
const req = (path: string, method = "GET", payload?: unknown, headers = {}) =>
  new Request("https://api.example" + path, {
    method,
    headers: {
      origin: "https://gongfpp.github.io",
      "content-type": "application/json",
      ...headers,
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
test("Tencent forwarding preserves privacy, QA isolation, idempotency, admin auth and cleanup without D1", async () => {
  const DB = createAnalyticsDB(),
    handle = createCollector({
      DB,
      ANALYTICS_INGEST_TOKEN: token,
      ANALYTICS_TOKEN: admin,
    });
  let forwarded: Request;
  const env = {
    ANALYTICS_ORIGIN: "https://stats.example/poor-map",
    ANALYTICS_INGEST_TOKEN: token,
    ANALYTICS_TOKEN: admin,
    QA_TOKEN: "qa",
    WRITE_PAUSED_UNTIL: "2099-01-01T00:00:00Z",
    ANALYTICS_FETCH: async (url: URL, options: any) => {
      forwarded = new Request(url, options);
      assert.equal(forwarded.headers.has("cf-connecting-ip"), false);
      assert.equal(forwarded.headers.has("x-qa-token"), false);
      assert.equal(forwarded.redirect, "manual");
      return handle(
        new Request(
          "http://local" + url.pathname.replace("/poor-map", "") + url.search,
          options,
        ),
      );
    },
  };
  const qa = { "x-qa-token": "qa", "x-qa-scope": "hosted-test" };
  try {
    assert.equal(
      (await worker.fetch(req("/api/analytics/stats"), env)).status,
      403,
    );
    assert.equal((await handle(req("/api/analytics/stats"))).status, 403);
    const payload = data();
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await worker.fetch(
            req("/api/analytics/events", "POST", payload, qa),
            env,
          )
        ).status,
        200,
      );
    const stats = await (
      await worker.fetch(
        req("/api/analytics/stats", "GET", undefined, {
          ...qa,
          authorization: "Bearer " + admin,
        }),
        env,
      )
    ).json();
    assert.equal(stats.summary.events, 1);
    assert.deepEqual(stats.dimensions[0].properties, { size: "mobile" });
    const publicStats = await (
      await worker.fetch(
        req("/api/analytics/stats", "GET", undefined, {
          authorization: "Bearer " + admin,
        }),
        env,
      )
    ).json();
    assert.equal(publicStats.summary.events, 0);
    assert.equal(
      (await worker.fetch(req("/api/analytics/qa", "DELETE", undefined), env))
        .status,
      404,
    );
    assert.equal(
      (
        await worker.fetch(
          req("/api/analytics/qa", "DELETE", undefined, qa),
          env,
        )
      ).status,
      200,
    );
    assert.equal(
      (await DB.prepare("SELECT COUNT(*) AS n FROM analytics_events").first())
        ?.n,
      0,
    );
    assert.equal(
      (
        await worker.fetch(
          req("/api/analytics/events", "POST", data(), {
            origin: "https://evil.example",
          }),
          env,
        )
      ).status,
      403,
    );
  } finally {
    DB.close();
  }
});
test("receiver caps batches/body/rate, rejects null records and does not save arbitrary fields", async () => {
  const DB = createAnalyticsDB();
  const handle = createCollector({
    DB,
    ANALYTICS_INGEST_TOKEN: token,
    ANALYTICS_TOKEN: admin,
  });
  const headers = {
    "x-analytics-key": token,
    "x-analytics-scope": "public",
    "x-analytics-rate": "a".repeat(64),
  };
  try {
    assert.equal(
      (
        await handle(
          req(
            "/api/analytics/events",
            "POST",
            { session: crypto.randomUUID(), events: Array(25).fill(null) },
            headers,
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await handle(
          req(
            "/api/analytics/events",
            "POST",
            { session: crypto.randomUUID(), events: [null] },
            headers,
          ),
        )
      ).status,
      200,
    );
    for (let i = 0; i < 118; i++)
      assert.equal(
        (await handle(req("/api/analytics/events", "POST", data(), headers)))
          .status,
        200,
      );
    assert.equal(
      (await handle(req("/api/analytics/events", "POST", data(), headers)))
        .status,
      429,
    );
    const server = createCollectorServer({
      DB,
      ANALYTICS_INGEST_TOKEN: token,
      ANALYTICS_TOKEN: admin,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address() as any;
      assert.equal(
        (
          await fetch(`http://127.0.0.1:${address.port}/api/analytics/events`, {
            method: "POST",
            body: "x".repeat(8193),
          })
        ).status,
        413,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    DB.close();
  }
});
test("receiver unavailable or redirect returns failure without falling back to D1", async () => {
  for (const response of [
    () => {
      throw new Error("down");
    },
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example" },
      }),
  ]) {
    const env = {
      ANALYTICS_ORIGIN: "https://stats.example/poor-map",
      ANALYTICS_INGEST_TOKEN: token,
      ANALYTICS_FETCH: response,
    };
    assert.equal(
      (await worker.fetch(req("/api/analytics/events", "POST", data()), env))
        .status,
      503,
    );
  }
});

test("loopback reverse proxy preserves public scope; localhost does not turn production traffic into development", async () => {
  const DB = createAnalyticsDB();
  const handle = createCollector({
    DB,
    ANALYTICS_INGEST_TOKEN: token,
    ANALYTICS_TOKEN: admin,
  });
  try {
    const response = await handle(
      new Request("http://127.0.0.1/api/analytics/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-analytics-key": token,
          "x-analytics-scope": "public",
          "x-analytics-rate": "b".repeat(64),
        },
        body: JSON.stringify(data()),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(
      (await DB.prepare("SELECT scope FROM analytics_events").first())?.scope,
      "public",
    );
  } finally {
    DB.close();
  }
});
