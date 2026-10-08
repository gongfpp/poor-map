import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverStores, parsePois, mergeStores } from "../src/discovery";
import { wgs84ToGcj02, distance } from "../src/domain";
import { seedStores } from "../src/store-domain";
test("POI mapping keeps stable vendor IDs, converts coordinates and never invents price or stock", () => {
  const raw = [
    {
      name: "蜜雪冰城",
      address: "公园路73号",
      hotPointID: "ABC123",
      lonlat: "121.54278,29.87823",
      price: 0,
      phone: "private-not-retained",
    },
    { name: "其他门店", lonlat: "121,29" },
    { name: "蜜雪冰城总部", lonlat: "121,29" },
    { name: "蜜雪冰城", lonlat: "NaN,29" },
  ];
  const out = parsePois(raw, "mixue", "蜜雪冰城");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "td-ABC123");
  assert.equal(out[0].source, "tianditu");
  assert.equal(out[0].price, undefined);
  assert.ok(!("phone" in out[0]));
  assert.ok(
    distance(out[0].location, wgs84ToGcj02([121.54278, 29.87823])) < 0.01,
  );
});
test("query partial failures remain visible while successful candidates are distance filtered", async () => {
  let calls = 0;
  const center = wgs84ToGcj02([121.54278, 29.87823]);
  const fetcher = async (url: any) => {
    calls++;
    const p = JSON.parse(new URL(url).searchParams.get("postStr")!);
    assert.equal(p.count, 20);
    assert.equal(p.queryType, 3);
    assert.equal(p.pointLonlat, "121.543,29.878");
    if (p.keyWord === "好特卖")
      return Response.json({ status: { infocode: 2001 } });
    return Response.json({
      status: { infocode: 1000 },
      count: p.keyWord === "蜜雪冰城" ? 30 : 0,
      pois:
        p.keyWord === "蜜雪冰城"
          ? [
              {
                name: "蜜雪冰城",
                lonlat: "121.54278,29.87823",
                hotPointID: "test1",
              },
              {
                name: "蜜雪冰城远店",
                lonlat: "116.39,39.91",
                hotPointID: "far",
              },
            ]
          : [],
    });
  };
  const d = await discoverStores(
    "test-" + crypto.randomUUID(),
    center,
    1000,
    false,
    undefined,
    fetcher as typeof fetch,
  );
  assert.equal(calls, 7);
  assert.equal(d.stores.length, 1);
  assert.ok(d.warnings.some((x) => x.includes("好特卖")));
  assert.ok(d.warnings.some((x) => x.includes("20家")));
});
test("complete provider failure is an error and no candidate becomes a demo", async () => {
  await assert.rejects(
    discoverStores(
      "test-" + crypto.randomUUID(),
      [121.55, 29.87],
      3000,
      false,
      undefined,
      (async () =>
        Response.json({ status: { infocode: 10001 } })) as typeof fetch,
    ),
    /暂不可用/,
  );
});
test("merging retains community identity and does not migrate comments on a fuzzy name", () => {
  const user = seedStores[0],
    duplicate = { ...user, id: "td-duplicate", source: "tianditu" as const },
    another = { ...duplicate, name: "好特卖另一店", id: "td-other" };
  const merged = mergeStores([user], [duplicate, another]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, user.id);
});
