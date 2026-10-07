import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.mjs";
import { createWaterDB } from "../server/water-db.mjs";
import { cleanProperties } from "../src/telemetry-schema";
const request = (
  path: string,
  method = "GET",
  data?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request("https://api.example" + path, {
    method,
    headers: {
      origin: "https://gongfpp.github.io",
      "content-type": "application/json",
      ...headers,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
test("shared comments allow recursive correction and reject cross-store replies", async () => {
  const DB = createWaterDB(),
    env = { DB, QA_TOKEN: "private" };
  try {
    const r = await worker.fetch(
      request("/api/community/comments", "POST", {
        storeId: "demo-宁波-0",
        content: "团购8.9元一箱",
      }),
      env,
    );
    assert.equal(r.status, 201);
    const c = (await r.json()).comment;
    const d = (
      await (
        await worker.fetch(
          request("/api/community/comments", "POST", {
            storeId: c.storeId,
            parentId: c.id,
            content: "刚去已恢复原价",
          }),
          env,
        )
      ).json()
    ).comment;
    const reply = await worker.fetch(
      request("/api/community/comments", "POST", {
        storeId: c.storeId,
        parentId: d.id,
        content: "补充新活动",
      }),
      env,
    );
    assert.equal(reply.status, 201);
    assert.equal((await reply.json()).comment.rootId, c.id);
    const all = await (
      await worker.fetch(
        request(
          "/api/community/comments?store=" + encodeURIComponent(c.storeId),
        ),
        env,
      )
    ).json();
    assert.equal(all.comments.length, 3);
    assert.equal(
      (
        await worker.fetch(
          request("/api/community/comments", "POST", {
            storeId: "other",
            parentId: c.id,
            content: "串店",
          }),
          env,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await worker.fetch(
          request("/api/community/comments", "POST", {
            storeId: c.storeId,
            content: "",
          }),
          env,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await worker.fetch(
          request(
            "/api/community/comments",
            "POST",
            { storeId: c.storeId, content: "x" },
            { origin: "https://evil.test" },
          ),
          env,
        )
      ).status,
      403,
    );
  } finally {
    DB.close();
  }
});
test("telemetry whitelists properties, deduplicates events, restricts stats and isolates QA", async () => {
  const DB = createWaterDB(),
    env = { DB, QA_TOKEN: "private", ANALYTICS_TOKEN: "admin-secret" },
    headers = { "x-qa-token": "private", "x-qa-scope": "community-test" };
  try {
    const id = crypto.randomUUID(),
      session = crypto.randomUUID(),
      data = {
        session,
        events: [
          {
            id,
            page: "home",
            name: "filter_change",
            properties: {
              category: "discount",
              latitude: 29.8,
              query: "private text",
              content: "secret",
              count: 5,
            },
          },
        ],
      };
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await worker.fetch(
            request("/api/analytics/events", "POST", data, headers),
            env,
          )
        ).status,
        200,
      );
    assert.equal(
      (await worker.fetch(request("/api/analytics/stats"), env)).status,
      403,
    );
    const stats = await (
      await worker.fetch(
        request("/api/analytics/stats", "GET", undefined, {
          ...headers,
          authorization: "Bearer admin-secret",
        }),
        env,
      )
    ).json();
    assert.equal(stats.summary.events, 1);
    assert.deepEqual(stats.dimensions[0].properties, {
      category: "discount",
      count: 5,
    });
    const publicStats = await (
      await worker.fetch(
        request("/api/analytics/stats", "GET", undefined, {
          authorization: "Bearer admin-secret",
        }),
        env,
      )
    ).json();
    assert.equal(publicStats.summary.events, 0);
    const c = (
      await (
        await worker.fetch(
          request(
            "/api/community/comments",
            "POST",
            { storeId: "test", content: "qa" },
            headers,
          ),
          env,
        )
      ).json()
    ).comment;
    assert.ok(c.id);
    assert.equal(
      (
        await worker.fetch(
          request("/api/community/qa", "DELETE", undefined, headers),
          env,
        )
      ).status,
      200,
    );
    const after = await (
      await worker.fetch(
        request("/api/analytics/stats", "GET", undefined, {
          ...headers,
          authorization: "Bearer admin-secret",
        }),
        env,
      )
    ).json();
    assert.equal(after.summary.events, 0);
  } finally {
    DB.close();
  }
});
test("telemetry strips URLs, coordinates, arbitrary strings and unbounded values", () => {
  assert.deepEqual(
    cleanProperties({
      action: "save",
      count: 5,
      enabled: true,
      latitude: 30,
      url: "https://secret",
      length: Infinity,
      mode: "private",
      content: "note",
    }),
    { action: "save", count: 5, enabled: true },
  );
});
