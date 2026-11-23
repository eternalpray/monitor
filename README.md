# DDS 轻量监控工具（DDS Light Monitor）

一个运行在本机、只读本地 DDS 采集节点 XML 文件、通过浏览器实时展示采集数据的**单进程轻量监控工具**。
零数据库、零外部网络依赖、纯 JavaScript、x64 / arm64 共用同一份产物。

- **后端**：Node.js + Express + chokidar + fast-xml-parser + iconv-lite
- **前端**：React 18 + Vite 5（深色仪表盘，SVG 自绘图表，无 CDN/外部字体）
- **实时**：SSE（Server-Sent Events）单向推送，浏览器原生 `EventSource` 自动重连
- **（v1.1）拓扑下钻**：主视图为 **Domain 域级列表**，点击域以右侧抽屉逐级下钻到 **域详情 → 参与者 / 主题**，并内置 **QoS 兼容性静态判定**（DDS RxO 规则）

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

## 1.5 多层级抽屉下钻（v1.1）

界面主视图为 **Domain 域级列表**，每行展示该域的参与者数 / 去重 IP / 主题数 / 写读端点数 / 健康状态 / 兼容性结论。

| 层级 | 内容 | 进入方式 |
| --- | --- | --- |
| L0 主视图 | 域级列表 + 全局概览卡片 | 默认 |
| L1 抽屉 A | 域详情：头部汇总 + 「域参与者 / 主题」两个视图 + IP/主题/状态过滤 | 点击某个域 |
| L2 抽屉 B | 参与者详情：GUID/IP/PID/QoS 明细、发布与订阅主题列表 | 点击 L1 参与者 |
| L2 抽屉 C | 主题详情：发送 IP / 接收 IP、收发关系图（SVG）、兼容性分析 | 点击 L1 主题 |

交互：右侧滑入、L2 叠加于 L1 之上、顶部面包屑、`ESC` 逐级关闭、点击遮罩关闭当前级；SSE 增量刷新只更新变化字段，不重置过滤条件与滚动位置。

### QoS 兼容性判定规则（RxO）

对同一 `domainId + topic` 下每个 **writer × reader** 配对做静态判定（`Offered` = 发布端、`Requested` = 订阅端）：

| 维度 | 规则 |
| --- | --- |
| 类型名 | 必须一致 |
| Partition | 分区集合需有交集，或双方均为空 |
| Reliability | `Offered ≥ Requested`（`BEST_EFFORT=0 < RELIABLE=1`） |
| Durability | `Offered ≥ Requested`（`VOLATILE=0 < TRANSIENT_LOCAL=1 < TRANSIENT=2 < PERSISTENT=3`） |
| Deadline | `Offered.period ≤ Requested.period`（`INF` 无穷大） |
| Liveliness | `Offered.kind ≥ Requested.kind` 且 `Offered.lease ≤ Requested.lease` |
| Ownership | 必须相等（`SHARED` / `EXCLUSIVE`） |

结论：任一关键字段缺失 → `UNKNOWN`（不臆断）；全通过 → `COMPATIBLE`；否则 → `INCOMPATIBLE`。主题级：全部 `UNKNOWN` → `UNKNOWN`；`INCOMPATIBLE` 与 `COMPATIBLE` 并存 → `PARTIAL`；其余 → `COMPATIBLE`。

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

### v1.1：结构化拓扑字段（参与者 / 端点 / QoS）

除 LJDDS 模板外，解析器会从任意结构良好的 XML 中提取 **域参与者 `participants[]`** 与 **发布/订阅端点 `endpoints[]`**（writer/reader），并归一化 QoS 字段（`reliability` / `durability` / `deadline` / `liveliness` / `ownership` / `partition`）。只要采集节点上报 `domainId`、参与者 `guid/ip`、端点 `role/topic/ip` 与关键 QoS，即可自动获得域下钻与兼容性结论；字段缺失对应视图显示「—」，兼容性结论为 `UNKNOWN`（不臆造）。对齐示例见 PRD 附录 C。

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
| `domainWindowSec` | `300` | 域/主题聚合统计时间窗（秒） |
| `domainWindowRecords` | `500` | 聚合窗口内最多参考记录条数 |
| `domainEventThrottleMs` | `200` | 域相关 SSE 事件节流间隔 |
| `maxPairsPerTopic` | `400` | 单主题 writer×reader 配对上限（超出抽样） |

配置可**热更新**（`PUT /api/config` 或界面「设置」），切换监听目录 / 调整聚合窗口无需重启进程。

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
| GET | `/api/domains` | 域级列表（L0，`q/sort/status`） |
| GET | `/api/domains/:domainId` | 域详情（L1，`ip/name/status` 过滤） |
| GET | `/api/domains/:domainId/participants` | 按 IP 过滤参与者 |
| GET | `/api/domains/:domainId/topics` | 按主题名过滤主题 |
| GET | `/api/domains/:domainId/topics/:topicName` | 主题详情（发送/接收 IP + 兼容性） |
| GET | `/api/domains/:domainId/topics/:topicName/compatibility` | 单独获取兼容性分析 |
| GET | `/api/participants/:guid` | 参与者详情（L2-B） |
| GET | `/api/ips` | 可用 IP 清单（过滤下拉） |
| GET | `/api/monitor` | 监控端状态 + 当前配置 + 校验结果 |
| PUT | `/api/monitor/config` | 写入监控端 3 个配置文件（project_name/start_time 必填、至少一个域） |
| POST | `/api/monitor/start` | 校验并启动监控端（`cmd /c start_ljdds_monitor_service.bat`） |
| POST | `/api/monitor/stop` | 停止监控端（`cmd /c stop_ljdds_monitor_service.bat`） |
| POST | `/api/monitor/save` | 保存当前读取的 XML（可选 `body.dest`） |
| GET | `/api/monitor/files` | 列出监控端输出目录 XML |

SSE 事件：`hello` / `snapshot`（含 `domains[]`、`monitor`）/ `records` / `stats` / `watcher` / `alert` / `heartbeat` / **`domains`** / **`domainDetail`** / **`compatibility`** / **`monitor`**。

> 主题名常含 `/`（如 `rt/vehicle/pose`），调用时需 `encodeURIComponent`。

---

## 5.5 监控端对接（解析端 ↔ ljdds_monitor_service）

按《解析端与监控端对接.md》，Web 前台可配置监控参数、启动/停止监控端，并持续读取监控端输出的 XML。

### 目录约定（config.json 的 `monitor` 块）

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `serviceDir` | `../ljdds_monitor_service` | 监控端目录（含 start/stop `.bat` 与 `config` 子目录） |
| `startScript` / `stopScript` | `start/stop_ljdds_monitor_service.bat` | 启动/停止脚本（Windows 经 `cmd /c` 执行） |
| `outputBaseDir` | 同 `serviceDir` | 监控端写 XML 的根目录，实际输出 `<outputBaseDir>/<project_name>/<start_time>/` |
| `saveBaseDir` | 解析端项目根 | “保存”按钮默认地址 `<saveBaseDir>/<project_name>/<start_time>/` |
| `autoDeleteOld` | `true` | 读到新 XML 后删除该目录下更旧的 XML（只保留最新） |

### 三个配置文件（写入 `<serviceDir>/config/`）

- `ljdds_monitor_service_cfg.ini`：`project_name`、`start_time`（必填）、`refresh_period`（默认 60 秒）、`is_self`（默认 0）。
- `ljdds_monitor_service_domaincfg.xml`：`<domain multicast_address="239.255.x.1" value="x"/>`，至少一个域，组播地址可改。
- `ljdds_monitor_service_topiccfg.xml`：`<monitor_topic mode="any"><topic name="…"/></monitor_topic>`，留空 = 监控所有主题。

### 前台交互

- 控制栏「配置 / 启动 / 停止 / 保存」；启动前须完成配置，否则提示「请先完成监控配置」并弹出配置弹窗。
- 读取到新 XML 后显示「已导入 …（解析 N 条，新增 N 条）」，旧 XML 自动删除，界面平滑更新。

### 缺失降级

`serviceDir` 或 `.bat` 脚本不存在时：配置写入仍会创建 `config` 目录；「启动/停止」返回
`SERVICE_NOT_FOUND` 并在前台提示，不抛异常、不影响已有解析展示。

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
├── server/                 # 后端（index/config/logger/parser/watcher/store/aggregate/compatibility/sse/routes/demo）
│   └── public/             # Vite 预构建产物（生产直接托管）
├── web/                    # React + Vite 前端（DomainList / DrawerStack / DomainDetail / ParticipantDetail / TopicDetail / IpTopicGraph / CompatibilityPanel）
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
