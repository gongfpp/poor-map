import test from "node:test";
import assert from "node:assert/strict";
import { brandCategory, matchesBrand, isStoreName } from "../src/store-brands";
import { validateStore } from "../src/store-domain";

test("NB aliases and ALDI variants share categories without turning supermarket tenants into supermarkets", () => {
  for (const name of [
    "超盒算NB(镇海店)",
    "宁波超盒算NB长丰店",
    "盒马 NB(上海店)",
    "ALDI奥乐齐(测试店)",
    "乐尔乐特价批发超市(测试店)",
  ])
    assert.equal(brandCategory(name), "discount");
  assert.ok(matchesBrand("盒马 NB(测试店)", "超盒算"));
  for (const name of [
    "永辉超市(宁波店)",
    "上蔬永辉生活超市",
    "沃尔玛(测试店)",
    "大润发(测试店)",
    "三江购物(测试店)",
    "物美大卖场(测试店)",
    "华润万家(测试店)",
    "盒马鲜生(测试店)",
    "家家悦(测试店)",
  ])
    assert.equal(brandCategory(name), "supermarket");
  assert.equal(brandCategory("蜜雪冰城(北仑大润发一楼店)"), "mixue");
  assert.equal(brandCategory("肯德基(沃尔玛店)"), undefined);
  assert.equal(brandCategory("永辉汽车修理"), undefined);
});
test("facilities and closed shops are excluded, while users can mark an explicitly located supermarket", () => {
  for (const name of [
    "沃尔玛停车场",
    "沃尔玛取货处",
    "奥乐齐总部",
    "永辉超市(已停业)",
  ])
    assert.equal(isStoreName(name), false);
  assert.equal(isStoreName("沃尔玛(测试店)"), true);
  assert.equal(
    validateStore({
      name: "沃尔玛(测试店)",
      category: "supermarket",
      address: "",
      location: [121.55, 29.87],
    }),
    null,
  );
});
