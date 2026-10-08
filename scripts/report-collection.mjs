import { readFileSync, writeFileSync } from "node:fs";
import { collectionCities, cityListSource } from "../src/collection-cities.ts";
const job = JSON.parse(readFileSync(".data/city-collection.json", "utf8")),
  rows = collectionCities.map((c) => ({ ...c, ...job.cities[c.name] }));
const sum = rows.reduce((n, c) => n + Object.keys(c.stores || {}).length, 0),
  scanned = rows.filter((c) => c.scanned).length;
const text = `# 城市采集记录\n\n生成时间：${new Date().toISOString()}。范围56城市，已读取${scanned}城市的配置关键词分页；当前本地去重${sum}条参考门店。采集数据另经私密导入写D1，线上数量以公开 /api/discovery/summary 为准。\n\n来源：[第一财经2025城市名单](${cityListSource})；门店来自高德官方搜索接口。2026榜单停止发布城市分级，故沿用最新可取得的2025名单，另补大陆省会/首府。\n\n当前仅覆盖6种硬折扣品牌及蜜雪冰城，不能解释为所有低价店、现实全量或营业/价格证明。先采宁波与四个一线，再扩展其余。高德部分接口reported总数大于翻页实际返回，继续翻页仍为空；即使「分页吻合」也不能证明现实全量。记录保留原始厂商ID和来源，不模糊转移评论。\n\n| 城市 | 层级 | 参考门店数 | 本轮分页状态 |\n| --- | --- | ---: | --- |\n${rows.map((c) => `| ${c.name} | ${c.tier} | ${Object.keys(c.stores || {}).length} | ${c.scanned ? (c.complete ? "分页数量吻合，现实覆盖未知" : "已读取可返回分页，可能不完整") : c.lastError ? "中断，保留已读结果" : c.stores ? "收集中" : "尚未读取"} |`).join("\n")}\n\n采集累计高德请求${job.requests}次（含行政区/文本/多边形请求及早期解析校正，不等于单一产品计费数量）。未轮换Key绕过配额，预算/服务限额时停止。缓存和进一步采集/手动刷新命令见[CACHE.md](CACHE.md)。\n`;
writeFileSync("docs/COLLECTION_REPORT.md", text);
console.log({ cities: scanned, target: rows.length, stores: sum });
