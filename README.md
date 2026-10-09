# 穷鬼地图

以地图寻找附近硬折扣店和蜜雪冰城，用户用一句话分享线索、回复纠错；独立「便宜水」页面比较具体水价。界面保持地图、侧栏和手机底部列表，没有banner。

本轮已收集56城市、36,129条品牌门店参考记录并保存共享缓存，详见[城市采集记录](docs/COLLECTION_REPORT.md)。数据可能不完整，不能证明营业或低价。

[附近地图](https://gongfpp.github.io/poor-map/) · [便宜水](https://gongfpp.github.io/poor-map/#/water) · [GitHub 仓库](https://github.com/gongfpp/poor-map)

首页默认读取Cloudflare D1中已收集的品牌门店，再合并社区标记；只有点击「刷新门店」才调用地图厂商查询；评论和便宜水使用真实共享库。道路底图默认使用高德JS API，保留天地图备选，不展示示例门店。两条宁波水价来自用户提供，位置为商场/商圈参考点，库存、品牌和部分容量未知。地图候选不能证明在营业、低价或有货，所有UGC未核验。

首页默认「全部」，只启用硬折扣和蜜雪冰城；量贩零食归入硬折扣。门店卡片显示店名、类别、直线距离，不推断单品价格或店铺价格上限。旧分类配置保留用于后续扩展。选中门店后输入一句话即可分享，每条评论可以回复，回复可以继续回复。详见 [共享评论](docs/COMMUNITY.md)。

便宜水支持半径、大瓶/小瓶/整箱、每升价格、整份标价、距离和库存反馈筛选。波动价格按上限比较，未知容量不参与每升排序。详见 [便宜水](docs/WATER.md)。

当前在线界面以公开网站为准，历史原型截图不代表当前道路底图。

## 运行

需要Node.js24（SQLite和TypeScript类型擦除）。

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 ，API在127.0.0.1:8787。本地共享库在忽略的 `.data/water.sqlite`；构建后 `npm start` 可同时运行前后端。默认请求浏览器定位，失败回宁波；手动中心不会被迟到的定位覆盖，精确位置不写收藏ID或数据库。

## 高德配置与授权

```sh
cp .env.example .env
```

| 环境变量              | 用途                            | 保存位置                 |
| --------------------- | ------------------------------- | ------------------------ |
| AMAP_JS_KEY           | Web JS API2.0道路底图及地图交互 | 可被浏览器看到的公开标识 |
| AMAP_JS_SECURITY_CODE | 对应JS Key的请求校验            | 服务端代理附加           |
| AMAP_WEB_SERVICE_KEY  | 手动搜店、城市采集、地址定位与步行算路        | 服务端                   |

2026-10-07已在已登录账号创建专用应用及两类Key，仅配置本地少量测试。宁波周边查询实际返回赵一鸣和东鼓道好特卖。此前公开Worker未上传高德Key：控制台添加Key条款限制未购买许可的Key用于短期少量测试，并明确包括公开可获取应用的限制。[服务协议](https://lbs.amap.com/pages/terms/)与[技术许可](https://lbs.amap.com/upgrade)须按使用场景确认；官网通用基础版5万元/年，个人非研究学习用途需工单确认，不等同于个人最终报价。没有付费。

2026-10-08完成天地图个人开发者认证，创建“穷鬼地图”浏览器应用。`TIANDITU_WEB_KEY`保存在忽略的.env与Worker Secret，白名单为gongfpp.github.io和127.0.0.1。控制台矢量底图、矢量注记各10,000次/日；按需要加载，不预取或离线打包。Leaflet使用BSD-2-Clause许可，许可证随静态站点发布。

只使用高德JS底图同样需要JS Key和相应授权，省略Web服务Key只关闭自动搜店和地址查询。Leaflet等开源显示库本身免费，但道路底图的来源、大陆可达性和公开使用授权仍需确认，不能直接借用其他网站Key。

2026-10-09用户明确本轮为个人研究学习，先使用已有高德免费Key观察效果，不购买服务。当前Worker Secrets已配置三项高德凭据，默认/config返回高德公开JS标识；安全密钥与Web服务Key不返回前端。未来用途或付费由用户另行决定。

门店缓存改为手动更新，不自动过期。朋友访问、切换城市、拖动地图后搜索及改半径都只读共享数据库；地图SDK/道路瓦片和主动导航仍会请求供应商。已看过的门店有浏览器副本，服务器断连时明确显示离线状态；没有副本时不伪造数据。最多显示范围内最近500家，旧点位仍需核对。

展开「步行去硬折扣店」，选择设备位置或明确参考出发点，比较最多8家缓存折扣店的真实步行路线。显示距离、耗时、道路折线与文字指引，并提供带起終点的高德步行导航链接。没有可用路线时明确失败。城市范围、采集命令、额度/分页缺口、导航和备用状态见 [缓存与导航](docs/CACHE.md)。

高德SDK、POI与选点统一使用GCJ-02，不做二次偏移。天地图配置通过显式?map=tianditu保留兼容；不要混用两种供应商坐标。此前天地图仅查到两家蜜雪，不能代表该区域完整门店数。

东鼓道好特卖初始商圈点与高德同店POI相差约352米，现按B0H12LCG0X/B1-25修正。旧门店ID、评论和水价均保留，水价修改历史记录坐标更正；只迁移仍使用原始旧坐标的初始记录，不覆盖用户另改的位置。坐标仍为地图参考，不认证营业、当前价或库存。K11继续为商场范围，负一层超市具体铺位待补充。

## 统计

访问、筛选、地图、收藏、评论/回复、便宜水交互、错误及加载表现经白名单批量保存30天。匿名会话统计不等于独立人数；不收集定位、搜索词、评论正文、网址或设备指纹，可在数据说明关闭，也遵守Do Not Track。

```sh
npm run analytics:report
```

私密统计Token不在前端，聚合结果只通过受保护接口读取。详见 [埋点与统计](docs/ANALYTICS.md)。

## 发布与验证

源码main、静态产物gh-pages（持续维护分支）。API使用现有Cloudflare免费计划，无付费升级。先部署数据库增量schema和Worker，再发布Pages。

```sh
npm run build
npm test
npm run test:e2e
npm run deploy:api
npm run build:pages
npm run verify:pages
# 源码已提交且工作区干净后
npm run publish:pages
npm run verify:pages -- https://gongfpp.github.io/poor-map/
npm run verify:water -- https://gongfpp.github.io/poor-map/#/water
npm run verify:community -- https://gongfpp.github.io/poor-map/
npm run verify:map -- https://gongfpp.github.io/poor-map/
npm run verify:discovery -- https://gongfpp.github.io/poor-map/
npm run verify:navigation -- https://gongfpp.github.io/poor-map/
npm run verify:backups
```

Pages禁止请求本地API；门店、共享评论、便宜水和埋点请求独立HTTPS Worker。高德SDK及道路瓦片从官方域名加载，保留SDK自带版权标注；安全码经Worker代理附加。天地图备选按需加载官方瓦片。地图安全密钥、Web服务Key、QA和统计凭据均不进入构建。部署后核对deploy-meta.json的源码SHA并实测桌面与手机。

共享验收使用私密QA Token和隔离数据集，结束清理，不改公开线索。浏览器测试的适配返回是测试数据，不能证明真实地图。手机Chrome模拟不等于物理iPhone/Safari，大陆网络可达性尚未现场验收。

百度备用服务端凭据已配置SN签名，本地真实搜店和步行失败切换已通过，Cloudflare真实检索仍返回不可解析响应，尚不能称为在线可用的备用。腾讯按用户要求暂缓；天地图服务端Key仍待验证码授权。详见[备用接入状态](docs/CACHE.md)。

美团、大众点评、抖音没有获批的全城活动接口，当前未接入。没有账号系统、自动审核或实时库存。数据来源见 [DATA_SOURCES.md](docs/DATA_SOURCES.md)，公开范围与第三方许可见 [PUBLIC_NOTICE.md](PUBLIC_NOTICE.md)。

真实共享门店初始只收录用户提供的东鼓道好特卖，坐标为商圈参考点。读取共享缓存中的地图候选，ID使用厂商POI标识，收藏和评论保持同店关联，不按模糊店名迁移。查询未返回的地区保持空结果，可在地图上点选后补充门店。新增门店不自动写入设备GPS；地图加载失败禁用选点。门店统一保留GCJ-02坐标契约，天地图显示和选点进行双向转换。
