import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
function harness() {
  const source = readFileSync(
    new URL("../src/telemetry.ts", import.meta.url),
    "utf8",
  )
    .replace(/^import .*;\n/gm, "")
    .replace(/export /g, "");
  const navigator = {
    doNotTrack: "0",
    globalPrivacyControl: false,
    sendBeacon: () => false,
  };
  const stored = new Map<string, string>();
  const calls: any[] = [];
  const ctx: any = {
    navigator,
    crypto,
    Blob,
    location: { hostname: "gongfpp.github.io", hash: "" },
    STATIC_DEMO: true,
    WATER_API: "https://example.invalid",
    cleanProperties: (x: any) => x,
    sessionStorage: { getItem: () => null, setItem: () => {} },
    localStorage: {
      getItem: (k: string) => stored.get(k),
      setItem: (k: string, v: string) => stored.set(k, v),
    },
    fetch: (_u: any, o: any) => {
      calls.push(JSON.parse(o.body));
      return Promise.resolve({ ok: true });
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    transformSync(
      source + "\nglobalThis.api={track,flush,setAnalyticsEnabled};",
      { loader: "ts", format: "iife" },
    ).code,
    ctx,
  );
  return { ctx, navigator, calls, api: ctx.api };
}
test("旧采集器尊重GPC，发送前撤销丢弃且恢复不补报", async () => {
  const h = harness();
  h.navigator.globalPrivacyControl = true;
  h.api.track("page_view", {});
  await h.api.flush();
  assert.equal(h.calls.length, 0);
  h.navigator.globalPrivacyControl = false;
  h.api.track("page_view", {});
  h.navigator.globalPrivacyControl = true;
  await h.api.flush();
  h.navigator.globalPrivacyControl = false;
  await h.api.flush();
  assert.equal(h.calls.length, 0);
  h.api.track("page_view", {});
  h.api.setAnalyticsEnabled(false);
  h.api.setAnalyticsEnabled(true);
  await h.api.flush();
  assert.equal(h.calls.length, 0);
  h.navigator.doNotTrack = "yes";
  h.api.track("page_view", {});
  await h.api.flush();
  assert.equal(h.calls.length, 0);
});
test("撤销再恢复后延迟失败不重排旧批次", async () => {
  const h = harness();
  let reject: any;
  h.ctx.fetch = () =>
    new Promise((_a, b) => {
      reject = b;
    });
  h.api.track("page_view", {});
  const pending = h.api.flush();
  h.api.setAnalyticsEnabled(false);
  h.api.setAnalyticsEnabled(true);
  reject(new Error("late"));
  await pending;
  h.ctx.fetch = () => {
    throw new Error("旧事件不应重试");
  };
  await h.api.flush();
});
