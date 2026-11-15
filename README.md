# DDS 轻量监控工具（DDS Light Monitor）

一个运行在本机、只读本地 DDS 采集节点 XML 文件、通过浏览器实时展示采集数据的**单进程轻量监控工具**。
零数据库、零外部网络依赖、纯 JavaScript、x64 / arm64 共用同一份产物。

- **后端**：Node.js + Express + chokidar + fast-xml-parser + iconv-lite
- **前端**：React 18 + Vite 5（深色仪表盘，SVG 自绘图表，无 CDN/外部字体）
- **实时**：SSE（Server-Sent Events）单向推送，浏览器原生 `EventSource` 自动重连

---

## 1. 快速开始

```bash
# 1) 安装依赖（npm workspaces 一次装齐）
npm install

# 2) 构建前端产物到 server/public/
npm run build

# 3) 启动（单进程，默认 0.0.0.0:7788）
npm start
```

打开浏览器访问 <http://localhost:7788/>。

> 或直接一键脚本：`./start.sh`（缺依赖自动装、缺产物自动构建）。

### 开发模式（HMR）

```bash
npm run dev   # 并行启动 Vite(5173) + Express(7788)，Vite 代理 /api 到后端
```

---

## 2. 模板输入：LJDDS 域监控快照

本工具按 PRD 要求保持**格式宽容**（任意结构良好的 XML 均可接入），同时已内置对
`ljdds_domain_monitor` 域监控快照的适配（`config/config.json` 中的 `split` 与 `fieldAliases`）。

模板 `ljdds_domain_monitor_snapshot-*.xml` 的要点已内建处理：

| 模板特征 | 处理方式 |
| --- | --- |
| 根元素 `ljdds_domain_monitor` | 通用解析，保留 `raw` / `rawXml` 兜底 |
| 域 ID 在 `<domain value="82">` | `split.context` 把 `value` 归一为 `domain` |
| 参与者 `<participant><element>`（节点） | 拆分为 participant 记录 |
| 端点 `<endpoint><element>`（datawriter/datareader） | 拆分为 endpoint 记录，`topic_name`/`type_name` 归一为 Topic/类型 |
| **文件为 GBK/GB18030 编码**（无 XML 声明） | `parser.decodeBuffer` 自动检测：BOM → 严格 UTF-8 → GB18030 兜底 |

### 适配你自己的采集节点 XML

无需改代码，改 `config/config.json`：

- **标准字段别名**：`fieldAliases` 增加你 schema 里对应字段名（大小写不敏感）。
- **多记录拆分**：`split.recordPaths` 填“记录元素”的点路径（属性用 `@_name`）。
- **父级上下文继承**：`split.context` 填祖先字段到标准字段的映射（如时间、域 ID、计数）。

---

## 3. 配置说明（config/config.json）

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `host` / `port` | `0.0.0.0` / `7788` | 监听地址与端口，可用 `HOST`/`PORT` 环境变量覆盖 |
| `watchDir` | `./data/incoming` | 采集目录，`DDS_WATCH_DIR` 覆盖；相对路径基于项目根 |
| `recursive` | `true` | 递归子目录 |
| `bufferSize` | `5000` | 内存环形缓冲容量 |
| `stabilityThreshold`/`pollInterval` | `400`/`100` ms | awaitWriteFinish 写入稳定判定 |
| `debounceMs` / `readRecheckDelay` | `60`/`80` ms | 事件防抖 / 两次 stat 间隔 |
| `maxRetries` | `4` | 完整性重试次数（退避 150/300/600/1200ms） |
| `maxXmlPreviewBytes` | `32768` | 原始 XML 预览上限 |
| `maxFileSize` | `2097152` | 单文件大小上限（2 MB） |

配置可**热更新**（`PUT /api/config` 或界面「设置」），切换监听目录无需重启进程。

---

## 4. 四层防半截 XML 机制

| 层 | 机制 | 拦截问题 |
| --- | --- | --- |
| L1 | 文件名过滤（`.tmp/.part/.swp/~*` 等） | 临时/中间文件 |
| L2 | chokidar `awaitWriteFinish` | 文件仍在增长 |
| L3 | 60ms 防抖 + 读取前后三次 `stat`（size/mtimeMs/ino） | 读取过程中被改写 |
| L4 | `XMLValidator.validate()` + 退避重试 | 尾部标签未闭合/截断 |

解析失败仅告警不入库，文件补全后自动重新处理。

---

## 5. REST API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（Node/平台/架构/运行时间） |
| GET | `/api/records` | 记录查询（`limit/node/topic/status/q/since`） |
| GET | `/api/stats` | 统计聚合 |
| GET | `/api/metrics` | 可用数值指标名 |
| GET | `/api/series?metric=&limit=` | 指标时间序列 |
| GET | `/api/config` | 当前配置与监听状态 |
| PUT | `/api/config` | 热更新配置 |
| GET | `/api/errors` | 最近解析告警 |
| POST | `/api/scan` | 手动全量重扫 |
| POST | `/api/clear` | 清空内存缓冲 |
| POST | `/api/demo/emit?count=` | 生成演示数据（原子写） |
| POST | `/api/demo/slow` | 慢速分块写（验证防半截） |
| GET | `/api/events` | SSE 实时通道 |

SSE 事件：`hello` / `snapshot` / `records` / `stats` / `watcher` / `alert` / `heartbeat`。

---

## 6. 容器部署（多架构）

```bash
# 单架构
docker compose up -d

# 一次构建 linux/amd64 与 linux/arm64
docker buildx build --platform linux/amd64,linux/arm64 -t dds-light-monitor:1.0.0 .
```

采集目录以卷挂载，镜像内默认监听 `/app/data/incoming`。

---

## 7. 自检

```bash
npm start   # 先启动
npm run verify   # 另开终端：HTTP 自检（健康/查询/演示写入链路）
```

---

## 8. 目录结构

```
dds-light-monitor/
├── package.json            # npm workspaces（server + web）
├── config/config.json      # 外置配置（目录/防护参数/别名表/LJDDS split）
├── server/                 # 后端（index/config/logger/parser/watcher/store/sse/routes/demo）
│   └── public/             # Vite 预构建产物（生产直接托管）
├── web/                    # React + Vite 前端
├── data/incoming/          # 默认监听目录（示例 XML / 挂载点）
├── scripts/                # dev.mjs / selfcheck.mjs
├── Dockerfile / docker-compose.yml
├── start.sh
└── README.md
```

---

## 9. 安全与部署提示

- 默认绑定 `0.0.0.0` 便于局域网访问，生产环境应置于内网/防火墙后，或改绑 `127.0.0.1`。
- 工具对采集目录**只读**，不写、不改、不删采集节点生成的 XML。
- 界面原始 XML 做文本转义展示，避免脚本注入；不发起任何外部请求。
