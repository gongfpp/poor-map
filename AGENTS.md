# 项目事实与入口

本项目为穷鬼地图 Web 应用。命令与完成边界见 `README.md`，数据源与平台接入依据见 `docs/DATA_SOURCES.md`。

- 前端在 `src/`；筛选、价格、坐标和投稿验证以 `src/domain.ts` 为准。
- 高德周边关键词与查询在 `server/app.mjs`。SDK 安全密钥、Web 服务 Key 只能从服务端环境读取；`.env` 不进 Git。
- 演示数据只能来自 `src/data.ts` 并显示演示标识；真实请求失败必须显示错误。POI 没有价格时不能推断为零价，也不能根据品牌宣称最低价。
- `local` 优惠仅保存在当前浏览器，是未核验线索；有原始链接不等于已核验，平台状态没有授权实证就保持未接入。
- 验证命令：`npm run build`、`npm test`、`npm run test:e2e`。浏览器测试的真实模式返回为测试数据，不能用它证明真实 SDK/地图/平台验收。
- 公开仓库目标为 `gongfpp/poor-map`；`main` 为源码，`gh-pages` 为持续维护的静态部署产物分支，不按普通已完成任务分支删除。
- Pages 使用 `npm run build:pages`、`npm run verify:pages` 和 `npm run publish:pages`。静态构建通过 `src/config.ts` 关闭本地 API 请求；线上部署后核对 `deploy-meta.json` 的源码 SHA，并实测桌面与移动页面。
- 没有获得高德密钥时保留真实地图验收缺口。素材和公开范围见 `PUBLIC_NOTICE.md`，第三方许可随站点一起发布。
- `#/water` 为真实共享的便宜水页面，事实与边界见 `docs/WATER.md`；两条初始宁波价格来自用户提供，容量、来源平台、日期或店铺精度未知时保持未知。
- 便宜水由 `worker/index.mjs` + D1 保存，公开 API 为 `poor-map-api.gong7968.workers.dev`；本地使用 `.data/water.sqlite`。`src/water-domain.ts` 负责按升、规格、范围与状态筛选。
- 用户于2026-10-09明确本轮用途为个人研究学习，授权先使用高德现有免费Key观察效果，后续付费另行决定。高德JS Key、安全密钥、Web服务Key保存在忽略的.env与Worker Secrets；仅JS公开标识返回浏览器，安全密钥经SDK代理附加，Web服务Key仅后端使用。本轮真实Chrome底图已成功返回道路瓦片。
- `QA_TOKEN` 仅为私密隔离写入验证凭据，不能进入 Pages、Git 或普通日志。验证使用 `qa:<scope>` 数据，不写公开线索；结束清理对应数据集。
- 浏览器定位在首页与便宜水默认执行，失败时回宁波；不要将精确设备坐标存入演示收藏 ID，门店公开坐标只能来自明确的门店选择或用户输入。

- 界面按地图优先组织：不加 banner、宣传标题或装饰大图；参考 Nearcade 的全屏地图、桌面侧栏和手机底部抽屉逻辑。未知底图状态保持真实标识，不用虚构道路替代便宜水地图。

- 首页仅启用硬折扣与蜜雪冰城，量贩零食归硬折扣；不显示单品价、购买建议或店铺预算筛选。共享一句话评论与回复见docs/COMMUNITY.md，埋点白名单与保留规则见docs/ANALYTICS.md。ANALYTICS_TOKEN仅本地/Worker Secret，统计不采集位置、搜索词或评论正文。

- 天地图浏览器Key已在2026-10-08创建，白名单gongfpp.github.io/127.0.0.1；TIANDITU_WEB_KEY只在.env/Worker Secret配置，浏览器标识通过config?map=tianditu返回。Leaflet+官方WMTS按需加载；保留归属标注，不离线缓存/批量预取。天地图作为已有备选保留；默认高德研究试用配置。
- 首页默认真实共享门店；stores表初始为用户提供的东鼓道好特卖商圈参考点。新增必须明确地图点选，不自动把设备GPS当门店。旧示例评论不迁移到真实店铺。选点转换、错误和手机弹窗需要真实SDK与UI验收。

- 2026-10-09百度服务端AK/SK已创建，SN签名仅后端，轻量步行需timestamp；本地真实查询及高德失败后切百度通过。Cloudflare百度查询返回不可解析响应，在线备用未验收；不能把已配置Key说成已在线可用。腾讯用户明确暂缓；天地图服务端Key仍需当次验证码授权。验收命令npm run verify:backups，具体边界见docs/CACHE.md。

- 首页与便宜水默认 `GET /api/water/candidates` 只读D1永久缓存，不能触发供应商搜索；`POST`只用于明确点击「刷新门店」。没有TTL/定时刷新，失败保留旧记录。缓存与采集合同见`docs/CACHE.md`；`worker/place-cache.mjs`负责持久化、范围/数量限制，`scripts/collect-cities.mjs`负责56城市按额度采集。`DATA_ADMIN_TOKEN`仅本地/Worker Secret，批量导入不开放前端。地图瓦片不离线缓存。
- 采集优先宁波及四个一线，其他城市随后扩展；高德分页数与count不一致时保持不完整提示，不宣称现实全量。门店统一GCJ-02，不能将价格/社区身份模糊转移给厂商候选。
- `worker/navigation.mjs`比较最多8家缓存折扣店的真实步行路线；出发点必须明确选择，精确起点和路线不保存/不埋点。请求使用manual重定向，不跟随未知URL；无可用路线不能用直线替代。腾讯/百度只有对应服务Key配置及真实验收后才宣称可用。天地图浏览器Key不能冒充服务Key。CLI控制台操作受锁屏/驱动权限阻断时保持申请未完成。
- 东鼓道好特卖参考点已对照高德B0H12LCG0X修正至B1-25。worker/reference-migration.mjs只迁移仍使用原始旧坐标的初始记录，保留原门店ID与评论、当前水价和容量，并留水价修订历史；用户另改的位置不覆盖。amapId仅用于已确认同店的严格去重，不模糊迁移其他门店的讨论。

- 2026-10-09本轮已收集56城市36,129条品牌参考点，D1逐城核对一致；另有22条手动附近候选。采集报告见docs/COLLECTION_REPORT.md。真实D1免费写入限额已触发，WRITE_PAUSED_UNTIL为运行暂停标志（不控制门店缓存TTL）；当前只读路径不重复写入种子。SDK/地址/导航限流为有界实例内存桶，不称为强分布式限流。升级套餐需用户明确确认，当前未购买。
- 2026-10-09北京时间08:31免费写入恢复，线上水价共享编辑、反馈、评论回复及统计重新验收通过。`src/useWriteResume.ts`仅在已知暂停截止后轻量重读config恢复按钮，不触发门店刷新；缓存仍仅手动更新。
