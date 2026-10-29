# 使用统计

自建埋点：页面向 `POST /api/analytics/events` 批量发送事件，Cloudflare Worker 仅转发至腾讯云自建采集服务，SQLite 保存30天。地图、水价和社区仍使用原有 D1。没有外部分析 SDK、Cookie、设备指纹或广告追踪。匿名会话 UUID 保存在当前标签页的 sessionStorage，不能据此把「会话数」称作独立人数。默认开启；首页数据说明提供关闭开关，并遵守浏览器 Do Not Track。关闭后清空未发送队列。

事件名与属性白名单以 `src/telemetry-schema.ts` 为准。当前覆盖：页面访问、离开与停留；按钮、弹窗与列表切换；分类、范围、收藏、搜索长度与空结果；门店详情与导航；定位申请/成功/失败；地图加载/错误/重试/拖动/缩放/复位；共享评论查看、分享、回复、成功/失败；便宜水筛选、选点、提交、反馈、历史与刷新；接口错误、运行错误、页面加载及LCP表现。未发生或未实施的功能不会伪造事件。

天地图自动搜店记录query_start/query_success/query_error，只保存来源枚举tianditu、半径、结果数量；没有POI ID、店名或查询中心。地图厂商周边查询是用户使用功能时直接请求供应商，查询中心约100米精度；这一数据流不属于自建埋点，不保存在统计数据库。

不保存精确位置、搜索词、地址、店名、门店ID、评论正文、用户输入、完整网址、Referrer、堆栈或凭据。服务端再次清洗属性，未知字段或非枚举字符串一律丢弃。按服务端收件时间记时；同事件ID幂等写入。每批最多24条、请求体最多8192字节、队列最多96条；每IP每小时最多120批。失败缓冲有限，网络阻断、关闭统计及页面瞬时关闭可能导致缺数，因此这是行为观察，不能充当计费或精确人数系统。

统计访问受独立 `ANALYTICS_TOKEN` 保护，只留在忽略的 `.env`、Worker Secret 与腾讯云 systemd 加密凭据。`GET /api/analytics/stats?days=7` 使用 Authorization Bearer，只返回聚合会话/访问量、按天计数、按页面/事件计数和白名单维度，未经授权返回403。不把后台凭据放入 Pages。

```sh
npm run analytics:report
# 可指定后端地址和1-30天窗口
npm run analytics:report -- https://poor-map-api.gong7968.workers.dev 7
```

本地事件存入development范围，不混入公开统计；验收事件使用 `qa:<scope>` 隔离并清理，普通用户不能访问。统计写入不再消耗 D1 写入额度，本次没有购买付费分析服务。线上公开统计从新版上线后开始收集，不能恢复此前历史访问。

2026-10-09增加缓存读取/手动刷新成功与失败、导航起点类型/算路开始成功失败、底图切换事件。只记录固定枚举、结果/成功比较数量；不记录城市名称、POI ID、路线米数、起终点或指引正文。店库读取不请求供应商，步行算路的精确起点仅实时传给供应商与本次页面内存，不写统计数据库或埋点。此前浏览器自动搜店数据流说明为历史状态。


2026-10-30腾讯云部署：

- 流程：现有网页 → `poor-map-api.gong7968.workers.dev/api/analytics/*` → `https://stats.gongfpp.icu/poor-map/api/analytics/*` → 腾讯云 SQLite。前端地址与事件协议不变，已打开的旧页面仍可上报。Cloudflare 仍是入口，不表示已移除 Cloudflare 依赖。
- `worker/analytics.mjs`为本地/腾讯云共用协议；`worker/analytics-proxy.mjs`只转发白名单接口，不转发原始IP、Cookie、浏览器UA或QA凭据。`ANALYTICS_ORIGIN`为非秘密配置，`ANALYTICS_INGEST_TOKEN`仅服务端持有。转发失败返回503，前端有限队列重试，不静默写回D1。
- 腾讯云端再次校验事件/属性和管理员凭据，公网直连写入需要入口凭据；QA按`qa:<scope>`隔离，`DELETE /api/analytics/qa`只清理相应QA范围。既有community QA清理也同步清理腾讯云事件。
- 小时盐化的限流标识仅留在采集进程的有界内存，不落数据库。每小时120批、最多2000桶；这是单实例限流。服务重启会重置限流桶，统计数据保留。
- 服务启动、每小时及每次事件写入清理超过30天的事件；本地开发仍可使用SQLite原接口。当前实现没有可视化管理看板，管理查询继续使用受保护聚合接口和`npm run analytics:report`。
- 运行目录`/opt/poor-map-analytics/current`，服务`poor-map-analytics.service`，仅监听`127.0.0.1:3160`；数据`/var/lib/poor-map-analytics/events.sqlite`；凭据`/etc/credstore.encrypted/poor-map-analytics.env`，由systemd解密到运行时目录。Caddy在已有stats域名上按`/poor-map/*`转发，不改变其他统计站点。
- 部署：`node scripts/deploy-analytics.mjs`，通过已信任SSH主机发送版本包和加密凭据；`npm run deploy:api`发布入口。不要把凭据复制进命令行参数、浏览器或日志。首次部署还需按现有Caddy站点增加路径转发并验证后reload。
- 验收：`npm run verify:analytics`。真实桌面/手机首页与大水地图事件使用隔离QA范围，检查入库、属性清洗、重复提交去重、关闭统计/Do Not Track、服务重启持久化和测试数据清理。这里只验证埋点，不替代底图供应商验收。
- 回退：先保留当前服务配置和数据，再将`current`指向已验证的前一版本并重启本服务。入口代码或配置回退不得默认重新写D1，以免分裂统计数据。Caddy只移除本项目路径段，不覆盖其他服务的后续修改。


本次验收记录（2026-10-30）：

- 最近30天1,675条公开历史事件迁入腾讯云，逐条核对ID、会话、页面、事件、清洗后属性和收件时间一致；按核对快照清理D1旧统计副本。公开统计当时为62个匿名会话、118次页面访问，可能包含既有开发/验收流量，不代表独立用户人数。
- 最终真实Chrome桌面1440×960与手机390×844：首页和大水地图均收到事件，共40条隔离事件、6次成功上报；直接读取腾讯云SQLite核对数量，重启本服务后数量一致。重复提交不增计，隐私字段被过滤；关闭统计和模拟Do Not Track均无上报；QA范围最终清零。
- `npm run build`通过；接口/数据全套96项通过，随后新增正式流量范围回归并完成8项针对性复验。浏览器全套初次68通过、2失败、2既有跳过；手机编辑超时单独复验通过，时钟初始化竞态修复后桌面/手机4项全部通过。最终覆盖70项通过、2项既有跳过。
- Worker发布版本`34a8dbb5-4a7c-4dd5-9820-2c0d98b40fa4`。本轮未修改前端交互或静态资源，Pages继续使用`f8b34f1`版本，通过原接口接入腾讯云。
- 迁移命令为`node --import tsx scripts/migrate-analytics.mjs`；正式切换后用`--retire-source`逐条核对成功才清理快照之前的公开旧统计。此脚本不读取或清理门店、水价及评论数据。
