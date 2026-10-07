# 公开前审计

日期：2026-10-07。目标：公开 `gongfpp/poor-map` 源码与 GitHub Pages 静态演示。

结论：当前审计范围内没有发现阻断公开的真实凭据、私人资料或缺乏来源的素材。公开访问与授予开源许可分开声明，见 `PUBLIC_NOTICE.md`。

- 初始可达 Git 历史共 1 个源码 commit、28 个跟踪文件，检查了文件路径、文本内容、删除记录与作者信息。未发现已删除的秘密、真实 `.env`、私钥、GitHub/OpenAI/AWS 凭据或私人本机路径；作者邮箱为 GitHub noreply 地址。
- `.env.example` 的 Key 均为空，真实 `.env`、依赖目录、构建目录、测试输出与系统文件被忽略。服务端测试中的 `private-security`、`private-web-key` 是显式测试字符串，不是生产凭据。
- 测试地址和活动链接均为示例；没有真实用户数据、平台 Cookie、爬取数据、后台日志、数据库文件或内部服务地址。环回地址仅用于开发与测试。
- PNG 为本项目浏览器演示截图；SVG 道路、地图标记和 favicon 为项目代码。没有复制高德瓦片、平台截图、商标 Logo、商品图片或第三方字体。
- React、React DOM、Scheduler 和 Vite 的 MIT 许可，Lucide 的 ISC 及其 Feather 图标 MIT 许可全文随站点发布。Express 为 MIT、dotenv 为 BSD-2-Clause，由 npm 安装；源码仓库不包含它们的二进制包。
- 没有超过 2 MB 的跟踪文件。公开站点只包含静态构建和第三方许可，不包含服务端密钥。
- 静态构建明确展示演示状态，不向 Pages 发送 `/api` 或 `/_AMapService` 请求，禁用需要后端的地址搜索与定位入口；原始本地服务路径继续保留。

审计不替代地图或平台业务授权。真实高德、真实平台活动及大陆网络现场可达性仍未验收。上线验证由 `scripts/verify-pages.mjs` 执行，分别检查桌面与移动交互、错误请求、资源子路径和对应源码 SHA，实际部署完成以 GitHub 状态与线上运行结果为准。
