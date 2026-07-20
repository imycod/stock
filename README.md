# stock-analyzer

600759（洲际油气）分钟级行情采集、趋势分析与深度行情展示。数据来自新浪 / 腾讯 / 东方财富公开接口，本地 SQLite 持久化，**无需 API 密钥**。

## 功能

- 交易时段每分钟自动采集快照（价量、量比、主力净流入等）
- 多周期研判：分钟 / 日 K / 3 日 / 市场情绪 / 深度行情 / 综合得分
- 深度数据：逐笔成交、大单分布、筹码主峰、龙虎榜、融资融券、封单强度
- Web 仪表盘：日内与日 K 图表、信号卡片、深度行情面板

## 环境要求

- Node.js 18+（需支持原生 `fetch`）

## 快速开始

```bash
npm install
npm start
```

浏览器访问：<http://localhost:3009>（端口可在 `config.js` 或环境变量 `PORT` 中修改）。

手动采集一次：

```bash
npm run collect
```

## 配置

编辑 `config.js` 可更换监控标的、大盘基准、采集 cron 与数据库路径。

## 主要 API

| 路径 | 说明 |
|------|------|
| `GET /api/status` | 服务与数据统计 |
| `GET /api/quote` | 实时行情 |
| `GET /api/analysis?refresh=1` | 分析结果（含深度数据） |
| `GET /api/deep?refresh=1` | 深度行情 |
| `POST /api/collect` | 手动采集并刷新分析 |

## 数据说明

- 逐笔等为公开延时/摘要数据，**非券商级 Level-2**
- 融资融券历史依赖采集写入 `margin_snapshots` 后本地展示
- 仅供研究参考，不构成投资建议

## 目录结构

```
config.js          # 标的与调度配置
src/server.js      # HTTP 服务与定时任务
src/collector.js   # 采集与日 K 同步
src/analyzer.js    # 信号与图表数据
src/api/           # 行情与深度数据接口
src/storage/       # SQLite
public/            # 前端仪表盘
data/stock.db      # 运行时数据库（默认）
```