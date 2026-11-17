# yujie-dsh-plugin-cdp 可行性分析

> 结论：**可行，风险可控**。推荐路线 A（自研 CDP 内核，零第三方运行时依赖），当天可交出可用的 v1；路线 B（复用官方 browser-use + chrome-devtools-mcp 生态）作为可选加速/补充。
> 分析基准：本机 DSH `0.2.1-rc.5`（Electron 44.7.0）、Chrome `156.0.8078.80`、Edge `156.0.4314.58`、Node `v26.13.0`。

---

## 1. 需求拆解

| # | 能力 | 对应 CDP 域 | 本机实测 |
|---|---|---|---|
| 1 | 接管 Chrome / Edge（启动或依附） | `--remote-debugging-port` + `/json/version`、`/json/list`、`Target.*` | ✅ 双端通过 |
| 2 | 读取浏览器画面 | `Page.captureScreenshot` → 图片块 | ✅ 1280×757 PNG 约 80 KB |
| 3 | 点击/输入/滚动控制 | `Input.dispatchMouseEvent`、`Input.insertText`、`Input.dispatchKeyEvent` | ✅ `isTrusted:true`，计数 0→1，中文输入成功 |
| 4 | 读 DevTools 异常/报错 | `Runtime.exceptionThrown`、`Runtime.consoleAPICalled`、`Log.entryAdded`、`Network.loadingFailed` | ✅ 同步异常、未捕获 Promise 拒绝、`console.error` 全部取到（含堆栈） |
| 5 | 用于 DSH Web 开发自检 | 用 `ctx.connection.authenticatedUrl()` 打开带鉴权的 GUI 页面，再从其 CDP 会话读异常 | ✅ 鉴权 URL 机制已确认（无 token 时 HTTP 401） |

---

## 2. 平台侧事实核实（决定"能不能做成插件"）

| 事实 | 证据 | 影响 |
|---|---|---|
| 插件 = npm 包 + `dsh.bundle.patch`，`plugin_manager.install_bundle` 安装到 profile | `yujie-dsh-plugin-sider-motion` 现有实现、`references/host-plugin.md` | 交付形态确定：`DSH Plugins/yujie-dsh-plugins/plugins/cdp/` → 安装即生效 |
| Host 插件可注册任意模型工具 | `ctx.tools.register(defineTool({...}))`，`@deepseek-ai/dsh-tools` | 工具面完全开放，无需改 DSH 本体 |
| 工具结果可携带图片，模型能"看见" | `attachments.saveImage()` → `{type:'image', attachment}` 内容块（`dsh-tool-fs` 的 `read_image` 同款链路） | 截图直接进对话，无需额外 UI |
| 图片上限 | 20 MB / 8192 px / 64 MP（`dsh-attachment-local` 默认） | 1280×757 PNG 远低于上限，安全 |
| 图片有路由前提 | `read_image` 同款检查：当前模型须声明 `image` 输入 | 不支持时退化为落盘路径，见 §6 风险 2 |
| Host 插件可用现代 Node 能力 | Electron 44.7.0（Node ≥22），**内置全局 `WebSocket`**，无需 `ws` 依赖 | CDP 客户端零依赖实现 |
| 裸导入 `@deepseek-ai/*` 可解析 | `dsh-app-boot`：运行时把安装态包供给 ESM/CJS 解析器；`dsh-context` 已实测如此 | 可直接用 `defineTool`、`schemastery` |
| DSH GUI 需要 token | 无 token 访问 `http://127.0.0.1:59685/` 返回 401；`ctx.connection.authenticatedUrl(url)` 注入 launch token | `browser_open_dsh` 可自动登录打开 GUI |
| 已有浏览器扩展点（可选复用） | `browserUse` 服务：`register(name)` 独占槽位；官方包 `@deepseek-ai/dsh-browser-use` 等已在 npm 上发布到 `0.2.1-rc.5` | 见路线 B |
| 右侧栏可挂自定义标签 | Client Slot 树含 `sidebar.right.pane.tab`（可注册 tab 类型） | M3 面板可行 |

---

## 3. 实测清单（本机真实跑通，非纸面推演）

**Chrome 156（独立 `--user-data-dir`，headless=new）**

- `/json/version`：`Browser: Chrome/156.0.8078.80`，`Protocol-Version: 1.3`，浏览器级 ws 端点可用
- 页面 ws 连接 → `Page.enable` / `Runtime.enable` / `Log.enable` → `Page.navigate` 成功
- 截图：1280×757，81 758 B；DPR 覆盖后 1600×1200，148 204 B
- 点击：元素矩形 (115,84,150×48)，派发后 `isTrusted:true`，计数 0→1
- 输入：`Input.insertText` 写入「中文 CDP 输入」，`Enter` 键事件被页面收到
- 异常：`Error: boom`（同步）、`Error: reject-boom`（`Uncaught (in promise)`），均带 `description` 与调用栈
- 多标签：`Target.createTarget` ×2 → `Target.attachToTarget(flatten:true)` → 两个会话各自命中 tab-A / tab-B，互不串台；`/json/list` 同步可见 5 个 target；`Target.closeTarget` 正常

**Edge 156（同参数，独立 profile）**

- `/json/version`：`Edg/156.0.4314.58`；接管、导航、截图、点击、输入全部通过
- 差异：Edge 的 profile 会自带若干扩展后台页（`background_page`/`service_worker`/`iframe`），发现目标时需按 `type === 'page'` 过滤
- `Log.entryAdded` 在 Edge 全链路中成功捕获网络级错误：`Failed to load resource: net::ERR_UNSAFE_PORT` → 浏览器级日志可作异常补充通道

**环境与副作用（首轮探测结论）**

- 在 DSH `workspace-write` 沙箱内**直接 spawn** 浏览器会失败：Chrome/Edge 自身的 `sandbox_init` 被外层 seatbelt 拒绝（`sandbox initialization failed: Operation not permitted`，Chrome 首启 Trace/BPT trap 5、GPU FATAL）。临时加 `--no-sandbox --disable-gpu --disable-breakpad` 后可跑。
  → 这是**工具执行沙箱**的限制，不是 CDP 的限制。本插件由 Host 进程（Electron 主进程，不受 bash seatbelt 约束）自行 spawn，正常无需 `--no-sandbox`；仅当用户通过 bash 工具手动拉起浏览器时才需要。
- **同一 profile 双实例互斥**：第二实例 exit 21，`Failed to create .../SingletonLock: File exists` + `ProcessSingleton ... Aborting now to avoid profile corruption`；死 pid 的 stale lock 会被 Chrome 自动接管重写。
  → 插件必须保证"一个 user-data-dir 只有一个浏览器实例"，启动前探测/复用已有实例，避免误启动。
- **Edge 新 profile 会自动同步账号与扩展**（实测临时 profile 涨到 938 MB）。
  → 启动参数需加 `--disable-sync --disable-extensions`（或 `--disable-features=` 组合），并在文档标明"插件 profile 为独立沙箱，不与日常浏览器共享登录态"。
- `Log.entryAdded` 只收**浏览器级**日志（子资源加载失败等），`console.error` 走 `Runtime.consoleAPICalled`；**事件订阅必须先于触发**（`enable` 之前的事件收不到）。
- **未通过/待补**：用户日常使用中的 Chrome 仍无法直接接管（见 §6 风险 1）；`Log.entryAdded` 在纯内联脚本场景为空属正常。

---

## 4. 两条路线对比

| 维度 | 路线 A：自研 CDP 内核（推荐） | 路线 B：官方 browser-use + chrome-devtools-mcp |
|---|---|---|
| 形态 | `yujie-dsh-plugin-cdp` 一个包，Host + 可选 Client | bundle patch 启用 `@deepseek-ai/dsh-browser-use` + `...-chrome-devtools-mcp@0.2.1-rc.5` |
| 依赖 | 零（Node 内置 `WebSocket`） | `chrome-devtools-mcp@1.9.0` + `...-browser-use-runtime`，需联网安装/构建审批 |
| 工具面 | 自定 9–10 个，语义贴合"看画面→点→读异常" | 沿用 MCP 的 20+ 工具（含性能追踪、网络分析），但不可裁剪 |
| 截图回模型 | 原生图片块，尺寸/质量可调 | 取决于 MCP 返回形态 |
| 异常读取 | 自建环形缓冲 + 去重 + 归并堆栈，可直接回灌会话 | 用 MCP 的 console/network 工具 |
| 升级风险 | CDP 是稳定协议，几乎不随 DSH 版本漂移 | 需与 DSH 版本同步升级 peer 依赖 |
| 冲突 | 无 | 占用 `browserUse`/`computerUse` 独占槽位，与自研插件互斥 |
| 工期 | v1 当天；完整 2–3 天 | 半天启用，但可控性差 |

**建议**：v1 走 A；A 通过 `browserUse.register('cdp')` 占位（若该服务存在），后续若要 Lighthouse/性能 trace 再叠加 B，并在配置里二选一。

---

## 5. 推荐架构（路线 A）

```
yujie-dsh-plugin-cdp/
├── package.json          # dsh.bundle.patch + exports ./client ./locale ./icon
├── cordis.patch.yml      # 插入 host 行（可选 client 行）
├── index.js              # apply(ctx, config)：装配 Hub + 注册工具
├── lib/cdp/
│   ├── ws.js             # 最小 CDP 客户端：JSON-RPC 序号、事件分发、超时、一次重连
│   ├── launcher.js       # Chrome/Edge 探测、端口分配、独立 user-data-dir、优雅关闭
│   ├── hub.js            # 每 agent 一条连接 + 默认 target + 命令串行队列
│   ├── events.js         # exception/console/network 环形缓冲（去重、堆栈归并）
│   └── snapshot.js       # 可交互元素快照：@ref 编号 + role/name/坐标 + 稳定 selector
├── tools/                # 9 个工具的 schema + execute
├── locale/{en,zh}.json   # meta.title / meta.description
└── icon.svg
```

### 工具清单

| 工具 | 作用 | 关键参数 | 并发 |
|---|---|---|---|
| `browser_launch` | 启动或依附浏览器 | `browser`、`headless`、`url`、`port`、`userDataDir`、`attach` | 独占 |
| `browser_pages` | 列页/新建/切换/关闭 | `action`、`targetId` | 独占 |
| `browser_navigate` | 跳转并等待 | `url`、`waitUntil(load\|networkIdle)`、`timeoutMs` | 独占 |
| `browser_screenshot` | 截图回模型 | `fullPage`、`selector`、`format`、`quality`、`maxWidth` | 安全 |
| `browser_snapshot` | 给模型"可点的东西" | `interactiveOnly`、`maxNodes` | 安全 |
| `browser_click` | 点击 | `ref`/`selector`/`x,y`、`button`、`clickCount`、`afterScreenshot` | 独占 |
| `browser_type` | 输入 | `ref`/`selector`、`text`、`submit`、`clear` | 独占 |
| `browser_eval` | 执行 JS（可关闭） | `expression`、`awaitPromise` | 独占 |
| `browser_console` | 读异常/报错/网络失败 | `sinceId`、`level`、`pattern`、`limit`、`clear` | 安全 |
| `browser_open_dsh` | 开发自检：带鉴权打开当前 GUI | `path` | 独占 |

### 关键设计决策

1. **会话隔离**：`exec.agent.id` → 独立 `BrowserConnection`；同浏览器多 agent 时按 target 分派，配置项 `sharing: perSession | shared` 明确语义。
2. **命令串行化**：每条连接一个队列，避免 `Input.*` 与 `Page.*` 交错导致的竞态；只读工具（截图/快照/日志）走旁路并发。
3. **事件订阅时机**：`Runtime.enable` 必须在导航前完成，否则丢失早期异常；连接建立即订阅，缓冲按 target 分桶、带上递增 id 供 `sinceId` 增量读。
4. **资源清理**：全部走 `ctx.effect`；插件卸载时关连接、关浏览器（仅关自己启动的）、清空缓冲。
5. **超时与降级**：每个等待默认 10 s（Config 可调）；断线重连一次；浏览器被手动关闭 → 下次调用自动重建并明确报错。
6. **token 成本控制**：截图默认最长边 1280、`maxWidth` 可调；`browser_snapshot` 默认截断节点数并给摘要，避免把整页 DOM 塞进上下文。
7. **端口策略**：优先 `--remote-debugging-port=0`，启动后读 profile 下的 `DevToolsActivePort` 拿真实端口，避免固定端口与暴露面；绝不使用 `--remote-debugging-address=0.0.0.0`。
8. **截图语义**：`Page.captureScreenshot` 默认只截当前视口；整页截图用 `captureBeyondViewport` + `clip`。headless 下 `--window-size=1280,900` 的实际视口为 Chrome 1280×757 / Edge 1272×782（浏览器 UI 高度不同）。
9. **事件与命令的会话绑定**：Browser 级 ws + `flatten:true` 时，后续每条命令必须带 `sessionId`；page 级 ws 只对应单个 target。异常栈对 inline 脚本可能为空，必要时注入 `//# sourceURL=` 让堆栈可定位。

---

## 6. 风险与限制（已评估）

| # | 风险 | 说明 | 处置 |
|---|---|---|---|
| 1 | **无法接管用户日常 Chrome** | Chrome ≥136 起，使用默认 profile 时会忽略 `--remote-debugging-port`（见 [Chrome 官方说明](https://developer.chrome.com/blog/remote-debugging-port?hl=zh-cn)），Edge 同理 | 默认使用插件自管 profile（登录态首次登录后持久保留）；`attach` 仅对"本就带调试端口 + 非默认 profile"的实例生效；不触碰用户真实 profile |
| 2 | 图片路由不支持 | 当前模型未声明 `image` 输入时，截图无法进对话 | 自动降级：PNG 落盘 + 返回路径与尺寸，模型改用 `read_image`/面板查看 |
| 3 | 复杂 DOM 定位 | iframe、Shadow DOM、Canvas、虚拟滚动列表 | v1：主文档 + 同源 iframe；`browser_snapshot` 同时给坐标与 selector，点击按坐标兜底 |
| 4 | headless 与有头差异 | 字体、DPR、动画、扩展 | 默认有头（真实）；CI/后台用 `headless:true`，文档标注差异 |
| 5 | 外部副作用 | 启动浏览器、访问任意 URL | 首次 `browser_launch` 走审批或显式 `allowLaunch`；插件本身不受 bash 沙箱限制（Host 进程），需在文档中明示 |
| 6 | 长连接稳定性 | Electron 主进程持有 WS，浏览器崩溃/被关 | 心跳 + 断线重连 + 状态自愈；所有工具调用前校验连接 |
| 7 | 并发/多 agent | 多个 teammate 同时驱动同一浏览器会互相打断 | 串行队列 + `perSession` 默认；`shared` 模式在 UI/日志显式提示"共享屏幕" |
| 8 | 版本漂移 | DSH 升级可能改 `tools.register` / `defineTool` 契约 | 统一走 `defineTool`，少手写 schema；升级后跑一次冒烟用例 |
| 9 | 打包安装 | `install_bundle` 需审批；profile 层改动影响所有会话 | 先在 workspace 开发，安装后按 skill 校验 `application: applied` 与图标/文案 |
| 10 | profile 单例锁 | 同一 `user-data-dir` 第二实例 exit 21（`SingletonLock` 冲突） | 启动前探测端口与 `/json/version`：已有实例则复用，否则才 spawn；每会话/每配置一个独立目录 |
| 11 | Edge 自动同步 | 新 profile 自动拉账号与扩展（实测 938 MB，隐私与磁盘代价） | 固定带 `--disable-sync --disable-extensions --no-first-run --no-default-browser-check` |
| 12 | 沙箱内 spawn 浏览器失败 | bash 工具沙箱下浏览器自带 sandbox 初始化被拒 | 插件走 Host 进程直接 spawn（不受 seatbelt）；提供 `--no-sandbox` 兜底开关并在文档说明风险 |
| 13 | **CDP 端口无鉴权** | 本机任意进程连上即可完全控制浏览器（读页面、注入脚本、点按钮、取 cookie） | 端口固定回环、优先端口 0 + `DevToolsActivePort`、用完即关、文档显著提示；插件 profile 与日常浏览器隔离 |
| 14 | 整页截图未验证 | `captureBeyondViewport`/`clip` 本轮未实测；长页面高度受限 | M1 用视口截图打底，整页拼接在 M2 单独验证并加上限 |

---

## 7. 里程碑与工作量

| 阶段 | 内容 | 估算 |
|---|---|---|
| M1 | CDP 内核（ws/launcher/hub）+ `launch / pages / navigate / screenshot / click / type / eval / snapshot` | 900–1200 行，约 1 个工作日 |
| M2 | 异常与网络采集、`console`、`wait`、多标签会话 | 约 400 行，半天 |
| M3 | 客户端右侧栏面板（实时画面 + 异常列表 + 手动接管） | 400–600 行，约 1 天 |
| M4 | locale/icon/README、安装验证、双浏览器回归 | 半天 |

**v1（M1+M2）可在当天可用**，M3 视觉面板为增强项。

---

## 8. 需要确认的决策点

1. 路线：**A（自研）** / A+B 混用 / 只做 B？
2. 默认浏览器：Chrome 优先、Edge 兜底，还是由每次调用显式指定？
3. 有头 vs 无头默认值（建议有头，真实渲染）。
4. 是否要 M3 的右侧栏实时面板（会显著增加工作量）。
5. 首次启动浏览器是否强制走审批弹窗。

---

## 9. 实现状态（M1 已交付）

插件位于 `DSH Plugins/yujie-dsh-plugins/plugins/cdp/`，已通过 `plugin_manager` 安装到 `desktop` profile 并处于 active 状态（11 个工具）。零第三方运行时依赖：CDP 客户端用运行时内置 `WebSocket`，`defineTool` 由插件自带实现（link 目录无法解析安装态的 `@deepseek-ai/*`，这一点已实测并规避）。

### 已通过真实 Host 的端到端验证

| 能力 | 验证方式 | 结果 |
|---|---|---|
| 启动 Chrome | `browser_launch`（headless） | 独立 profile、随机端口、`about:blank` ✅ |
| 启动 Edge | `browser_launch browser=edge` | `Edg/156.0.4314.58`，profile 仅 3.2 MB（`--disable-sync` 生效）✅ |
| 导航 + 回图 | `browser_navigate` 本地页面 | 1024×657 PNG 进入对话，模型直接看到画面 ✅ |
| 元素快照 | `browser_snapshot` | 真实 DSH GUI 21 个可交互元素（ref/角色/名称/坐标）✅ |
| 点击 | `browser_click ref=r1` | 计数 0→1；DSH 欢迎弹窗「继续」点击后关闭 ✅ |
| 输入 | `browser_type` 中文 | 值回读完全一致 ✅ |
| 异常读取 | `browser_console level=error` | 同步异常 + 未捕获 Promise，含文件/行/列与调用栈 ✅ |
| 开发自检 | `browser_open_dsh` | 带 token 打开本 GUI，前端无 error 日志 ✅ |
| 关闭 | `browser_close` | 进程与端口全部回收，无残留 ✅ |
| 多标签 | 内核自测 `Target.createTarget` + flatten | 两个标签互不串台 ✅ |

内核另有 12/12 独立自测（`/tmp/cdp-selftest.mjs`，不经 Host）：启动、导航、快照、点击、中文输入、视口/缩放/整页截图、异常事件、分页、多标签、关标签。

### 尚未完成（后续里程碑）

- M3：右侧栏实时画面面板（`sidebar.right.pane.tab`），当前交互以对话内截图为主。
- 整页超长页面的分片截图（上限 4000 px，超出部分需分段）。
- iframe / Shadow DOM 内元素的深定位（当前主文档 + 同源 iframe 的顶层元素）。
- 配置项目前由插件自身归一化读取，没有对外 JSON Schema（link 安装无法引入 schemastery）；写入 `cordis.patch.yml` 的 `config` 仍可生效但不受 Loader 校验。

---

## 10. M2 / M3 收尾（已完成）

### 通道策略：结构优先，像素按需

`autoScreenshot` 默认改为 `false`：`browser_navigate` / `browser_click` 只返回文本结果，不再每次产生图片。需要"看"时显式调用 `browser_screenshot`。定位始终走 `browser_snapshot`（DOM/可访问性 + ref）或 `browser_read`（纯文本），不依赖像素。

### 深层定位（已实测）

`browser_snapshot` 现在递归 open shadow root 与同源 iframe，ref 通过页面侧注册表（`__yujieCdpRefs`）解析真实元素，测量时沿 `frameElement` 链换算到顶层视口坐标：

| 场景 | 结果 |
|---|---|
| 普通按钮 | `[r1] button "普通按钮" @(66,130)` ✅ |
| Shadow DOM 按钮 | `[r2] button "影子按钮" @(59,179) shadow`，点击后 `window.__shadowClicks === 1` ✅ |
| 同源 iframe 输入框 | `[r3] textbox "帧内输入框" @(124,245) frame`，中文输入回读一致 ✅ |
| 同源 iframe 按钮 | `[r4] button "帧内按钮" @(235,245) frame` ✅ |

### 截图增强（已实测）

- `grid: true`：注入 100 px 坐标网格与标签，截完立即移除，供像素级点击；实测 900×572 图上网格与标签清晰可读。
- `slices: true` + `fullPage: true`：长页自动切片，实测 5 段共 5 445 px 的页面切成 3 张（0–2400 / 2400–4800 / 4800–5445），逐张带 `offsetY`。
- 单张整页仍受 `maxCaptureHeight`（默认 4000 px）限制。

### 页面文本工具

新增 `browser_read`：返回页面或指定元素的可读文本（默认上限 8000 字符），不产生图片；用于读内容、验证断言、快速浏览长页。

### 右侧栏实时面板（代码完成，待重启生效）

- Host：`lib/panel.js` 注册 `GET /plugin/cdp/state?session=<id>` 与 `GET /plugin/cdp/shot?session=<id>&w=720`，只读、按会话键、绝不自行启动浏览器；截图带 800 ms 缓存。
- Client：`client.js` 注册 tab 类型 `cdpBrowser`、`sidebar.right.pane.tab` 主体、标题 chip，以及会话头部按钮（标题「查看受控浏览器」）；每 2 秒轮询状态与画面，显示最近 5 条 error。
- 验证：路由实测 `state` 返回 `connected:true` + 页面列表 + 最近 3 条错误（正好抓到了本地 CORS 测试产生的失败）；`shot` 返回 720×457 PNG。客户端模块在页面内用假 `__ModuleLoader__` + 假 ctx 冒烟通过：locale、tab 注册、两个 slot 注册、header 注入全部命中。
- **限制**：Web 客户端的模块图在应用启动时构建，新装的客户端半需要**重启一次 DeepSeek Harness** 才会出现在界面里；Host 工具与路由已即时生效。

### 本轮修掉的缺陷

1. `browser_evaluate` 返回数字/布尔时被输出 schema（string）拒绝 → 统一序列化为字符串。
2. iframe 元素的快照坐标曾是帧内坐标 → 改为沿 frameElement 链换算的顶层坐标。
3. iframe 元素被误标 `shadow`、且 `inViewport` 恒为 false → 修正标记与可见性判定。
4. 网格标签在缩放后不可读 → 字号/对比度提升，标签改为每 200 px 一个。
5. 长页整页截图被 4000 px 截断且无提示 → 增加分片模式。

### 可见的自动化（追加）

- **控制提示条**：启动时默认加 `--enable-automation`，Chrome 顶部出现「自动测试软件正在控制 Chrome」infobar；连接后 `Page.bringToFront` 把窗口带到前台。实测 OS 截图可见该提示条。
- **可见鼠标**：页面内注入固定层（`pointer-events: none`）画一个蓝色发光箭头；`browser_click` 先把它动画移动到目标（默认 260 ms），再派发 `Input.dispatchMouseEvent`，随后画 1.8 s 的点击涟漪与 `click` 标签；`browser_type` 同样先移动光标再聚焦输入。实测 1000×591 页面截图可见光标停在按钮/输入框上，点击计数 0→2。
- **命中校验**：测量时用 `document.elementFromPoint` 校验点击点是否落在目标元素上，结果带 `hitMatches`，为 false 时在文本里提示重新 `browser_snapshot`（Baidu 输入后建议面板展开导致旧 ref 位移的情形即由此暴露）。
- **配置**：`automationBanner`、`showCursor`、`cursorMoveMs` 三个开关。
- **环境限制**：Google 与百度在这台机器的出口 IP 上都直接返回图形验证码（`google.com/sorry/index`、`wappass.baidu.com`），与是否可见、是否有头无关；Bing 英文搜索正常。要长期用 Google，需要在受控窗口里人工过一次验证码（cookie 会留在插件 profile 里）。
