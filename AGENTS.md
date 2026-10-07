# 项目事实与入口

本项目为穷鬼地图 Web 原型。命令与完成边界见 `README.md`，数据源与平台接入依据见 `docs/DATA_SOURCES.md`。

- 前端在 `src/`；筛选、价格、坐标和投稿验证以 `src/domain.ts` 为准。
- 高德周边关键词与查询在 `server/app.mjs`。SDK 安全密钥、Web 服务 Key 只能从服务端环境读取；`.env` 不进 Git。
- 演示数据只能来自 `src/data.ts` 并显示演示标识；真实请求失败必须显示错误。POI 没有价格时不能推断为零价，也不能根据品牌宣称最低价。
- `local` 优惠仅保存在当前浏览器，是未核验线索；有原始链接不等于已核验，平台状态没有授权实证就保持未接入。
- 验证命令：`npm run build`、`npm test`、`npm run test:e2e`。浏览器测试的真实模式返回为测试数据，不能用它证明真实 SDK/地图/平台验收。
- 公开仓库目标为 `gongfpp/poor-map`；`main` 为源码，`gh-pages` 为持续维护的静态部署产物分支，不按普通已完成任务分支删除。
- Pages 使用 `npm run build:pages`、`npm run verify:pages` 和 `npm run publish:pages`。静态构建通过 `src/config.ts` 关闭本地 API 请求；线上部署后核对 `deploy-meta.json` 的源码 SHA，并实测桌面与移动页面。
- 没有获得高德密钥时保留真实地图验收缺口。素材和公开范围见 `PUBLIC_NOTICE.md`，第三方许可随站点一起发布。
