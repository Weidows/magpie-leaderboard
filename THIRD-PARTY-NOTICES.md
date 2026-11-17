# 数据来源与第三方声明

本插件是只读的数据浏览器，不是任何榜单的官方产品。页面内的分数、排名、价格与
评测结果均来自下列公开页面，版权与解释权归原站点所有。

## Artificial Analysis

- 站点：<https://artificialanalysis.ai/zh>
- 使用字段：Artificial Analysis Intelligence Index、Frontier Code、Terminal-Bench、
  AutomationBench、Omniscience、价格、输出速度、首 token 延迟等。
- 快照方式：抓取公开排行榜页面中随页面下发的模型数据，去重后写入本地快照。
  页面运行时不联网，因此分数可能落后于官网；底部会标注快照日期。
- 注意：Artificial Analysis Intelligence Index 是其自有复合指数，不能与
  Harness Leaderboard 的分数直接混排。

## Harness Leaderboard

- 页面：<https://huggingface.co/spaces/joelniklaus/harness-leaderboard>
- 仓库：<https://huggingface.co/spaces/joelniklaus/harness-leaderboard>
- 许可：Apache-2.0（见上游仓库）
- 使用字段：同一开源模型在多个 coding-agent harness 下的 overall 分数、通过率、
  置信区间、每次通过成本、耗时与两个基准（Terminal-Bench 2.1、Deep-SWE）的拆分。
- 快照方式：抓取 Space 的公开 `/api/index` JSON，压缩后写入本地快照。

## 商标

模型、公司与产品名称仅用于识别，商标归各自所有者所有。本插件与上述任何一方
均无隶属或背书关系。
