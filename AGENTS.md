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
- 高德专用两类Key已申请，仅保存在忽略的本地.env；宁波周边查询已成功。免费Key条款限制公开可获取应用，公开Worker不上传这些Key，公开接入等待适用许可或替代来源确认。本地Chrome SDK请求超时，底图尚未通过验收。
- `QA_TOKEN` 仅为私密隔离写入验证凭据，不能进入 Pages、Git 或普通日志。验证使用 `qa:<scope>` 数据，不写公开线索；结束清理对应数据集。
- 浏览器定位在首页与便宜水默认执行，失败时回宁波；不要将精确设备坐标存入演示收藏 ID，门店公开坐标只能来自明确的门店选择或用户输入。

- 界面按地图优先组织：不加 banner、宣传标题或装饰大图；参考 Nearcade 的全屏地图、桌面侧栏和手机底部抽屉逻辑。未知底图状态保持真实标识，不用虚构道路替代便宜水地图。

- 首页仅启用硬折扣与蜜雪冰城，量贩零食归硬折扣；不显示单品价、购买建议或店铺预算筛选。共享一句话评论与回复见docs/COMMUNITY.md，埋点白名单与保留规则见docs/ANALYTICS.md。ANALYTICS_TOKEN仅本地/Worker Secret，统计不采集位置、搜索词或评论正文。

- 天地图浏览器Key已在2026-10-08创建，白名单gongfpp.github.io/127.0.0.1；TIANDITU_WEB_KEY只在.env/Worker Secret配置，浏览器标识通过config?map=tianditu返回。Leaflet+官方WMTS按需加载；保留归属标注，不离线缓存/批量预取。高德Key仍不上传公开服务。
- 首页默认真实共享门店；stores表初始为用户提供的东鼓道好特卖商圈参考点。新增必须明确地图点选，不自动把设备GPS当门店。旧示例评论不迁移到真实店铺。选点转换、错误和手机弹窗需要真实SDK与UI验收。
