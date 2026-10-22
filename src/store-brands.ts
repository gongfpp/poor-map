// Shared by collection, manual discovery and the map. Brand names never imply prices.
export const brandQueries: ["discount" | "supermarket" | "mixue", string][] = [
  ["discount", "赵一鸣"],
  ["discount", "零食很忙"],
  ["discount", "零食有鸣"],
  ["discount", "好特卖"],
  ["discount", "嗨特购"],
  ["discount", "奥特乐"],
  ["discount", "超盒算"],
  ["discount", "盒马NB"],
  ["discount", "奥乐齐"],
  ["discount", "乐尔乐"],
  ["supermarket", "永辉超市"],
  ["supermarket", "沃尔玛"],
  ["supermarket", "大润发"],
  ["supermarket", "三江购物"],
  ["supermarket", "物美"],
  ["supermarket", "华润万家"],
  ["supermarket", "盒马鲜生"],
  ["supermarket", "家家悦"],
  ["mixue", "蜜雪冰城"],
];
export function collectionQueryTypes(category: string, keyword: string) {
  return category === "supermarket" || keyword === "乐尔乐" ? "060400" : "";
}
export function matchesBrand(name: string, keyword: string) {
  const compact = name.replace(/\s+/g, "");
  if (keyword === "超盒算" || keyword === "盒马NB")
    return /超盒算|盒马NB/i.test(compact);
  if (keyword === "奥乐齐") return /奥乐齐|ALDI/i.test(compact);
  if (keyword === "好特卖") return /好特卖|hotmaxx/i.test(compact);
  if (keyword === "永辉超市") return /永辉.*超市|上蔬永辉/.test(compact);
  return compact.toLowerCase().includes(keyword.toLowerCase());
}
export function brandCategory(name: string) {
  // A tenant called “蜜雪冰城(大润发店)” belongs to Mixue, not its host supermarket.
  const storefront = name.split(/[（(]/)[0];
  return brandQueries.find(([, keyword]) =>
    matchesBrand(storefront, keyword),
  )?.[0];
}
export function isStoreName(name: string) {
  return (
    !!name.trim() &&
    !/总部|总仓|仓库|供应链|分公司|有限公司|配送中心|培训|停车场|出入口|取货处|公交站|地铁站|充电站|洗手间|卫生间|暂停营业|停止营业|已关闭|已停业|装修中|全球电商|电子商务|电商运营|装修(?:[)）]|$)/.test(
      name,
    )
  );
}
export function discoveryGroups(mode: string) {
  const categories =
    mode === "home"
      ? ["discount", "mixue", "supermarket"]
      : ["discount", "supermarket", "market"];
  return categories.map((category) => [
    category,
    category === "market"
      ? "超市"
      : brandQueries
          .filter(([c]) => c === category)
          .map(([, keyword]) => keyword)
          .join("|"),
  ]);
}
