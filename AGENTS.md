# 竞技榜（magpie-leaderboard）

Magpie 页面插件，零运行时依赖。页面是经典脚本（不能用 ES module），数据快照随包发布，
页面运行时不联网。

## Key Files

- `page/app.js` —— 所有渲染与交互：总览、模型表、Agent 排名、SVG 散点、热力图、弹窗、主题
- `page/style.css` —— 设计 token、浅色/深色、响应式；颜色变量在 `:root` 与
  `html[data-lb-theme="dark"]`
- `page/index.html` —— 页面壳与固定工具栏；`_magpie/bridge.js` 由宿主注入
- `page/data-aa.js` —— 生成物：`window.AA_DATA`
- `page/data-harness.js` —— 生成物：`window.HARNESS_DATA`
- `scripts/sync-aa.mjs` —— 从 `artificialanalysis.ai/leaderboards/models` 的
  Next.js flight 数据里取 `initialModels`
- `scripts/sync-harness.mjs` —— 从 HF Space 的 `/api/index` 取 `_all` effort 聚合
- `scripts/lib.mjs` —— `fetchText`、`decodeNextFlight`、`extractJsonAfter`、写模块

## Commands

| 命令 | 作用 |
| --- | --- |
| `npm run sync` | 刷新两份快照 |
| `npm run sync:aa` | 只刷模型快照 |
| `npm run sync:harness` | 只刷 Agent 快照 |
| `npm test` | 数据/变换纯函数测试 + `node --check page/app.js` |

## Red Lines & Gotchas

- **不要手改** `page/data-aa.js` / `page/data-harness.js`。改口径去 `scripts/`，再 `npm run sync`。
- 页面沙盒不支持 `type="module"`、跨文件 import、运行时 `fetch`；新增依赖要内联或写成
  独立经典脚本。不要引入需要构建的框架。
- 沙盒里 `localStorage` 可能抛 `SecurityError`；持久化优先 `magpie.options.get/set`，
  `localStorage` 只做浏览器预览兜底。复制功能如需添加，必须保留 `execCommand('copy')` 回退。
- 主题写到 `document.documentElement.dataset.lbTheme`，**不要**写 `data-theme`（那是 bridge 的）。
  主题变化必须重新渲染，因为散点/热图的颜色是 JS 计算的内联样式。
- `magpie.ready` 是 **Promise**（不是函数）：先 await 它，再读 `magpie.theme` / `magpie.options`；
  页面最多等 1.5 秒，避免宿主不回应时白屏。`magpie.onTheme(fn)` 的回调收到 `{ dark, lang, tokens }`，
  主题变化时要更新 `state.hostDark` 并重绘。
- `_magpie/bridge.js` 在浏览器预览时 404 属正常；页面所有 `magpie.*` 调用都必须有兜底。
- 混合价按 **3:1 输入:输出**（`0.75 * input + 0.25 * output`），不是反过来。
  AA 分数不能和 Harness 的 overall 混排。
- AA 去重按 `release.slug` 取最高 Intelligence Index；Harness 取 `efforts._all`。
  `macro` 是通过率，可跨模型比较；**`overall` 是模型内归一化指数**
  （50% 性能 + 50% 成本效率），只能在同一个模型内排名，不能拿去做跨模型热力图或
  “最佳组合”对比。跨模型统一用 `rate`。名次相同用 `=` 展示。
- 页面中的 1–2 分差距可能落在上游的重跑噪声里；不要把噪声写成确定结论。
- 上游字段是解析依赖：AA 的 `initialModels`、HF 的 `/api/index` 与 `_all` effort。
  改版时先修同步脚本，别在页面里硬编码补丁。
- 未获明确要求时，不要执行 `magpie plugin add`，不要发布 npm 或改版本号。
