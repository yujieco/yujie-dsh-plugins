# yujie-dsh-plugin-system-prompt

给 [DeepSeek Harness](https://www.deepseek.com/harness/)（DSH）用的插件：在每次对话的系统提示词**最前面**注入你自己写的一段内容，注入内容直接在**插件管理面板**里编辑。

简体中文 | [English](#english)

---

## 功能

- **自定义系统提示词**：保存后从下一个模型步开始生效，对所有会话、所有代理（含子代理）生效。
- **热更新**：改完即用，不需要重启 Harness，也不会打断当前会话。
- **三个编辑入口**，都在管理面板内，任选其一：
  - Plugins 页面顶部 Tab：`Installed / Discover` 之后的 **系统提示词**；
  - Settings → **内置插件** → **系统提示词** Tab；
  - 插件 bundle 详情页：描述与插件行之间的配置区。
- **开关与清空**：取消勾选「注入这段提示词」可临时关闭；清空文本并保存则完全移除注入。
- **位置固定**：注入内容紧跟在 Harness 固定身份之后、内置指引之前（system-prompt section order `-999`）。
- **不插值**：文本按字面量注入，可安全包含 `{{...}}` 之类的内容。
- **持久化**：配置写入当前 profile 的 `cordis.patch.yml`，重启后仍然生效。
- **中英文界面**：面板文案跟随 DSH 当前语言（简体中文 / English）。

已在 DeepSeek Harness `0.2.1-rc.5`（macOS Desktop）上验证：注入内容会出现在模型实际收到的系统提示词中。

## 安装

要求：DeepSeek Harness `0.2.1` 或更新版本（Web / Desktop 均可）。

**方式一：在 DSH 里安装（推荐）**

打开左侧栏 **Plugins** → **Add plugin**，填入仓库地址后安装：

```
git+https://github.com/yujieco/yujie-dsh-plugin-system-prompt.git
```

**方式二：命令行**

```sh
dsh plugin --profile <你的 profile> add git+https://github.com/yujieco/yujie-dsh-plugin-system-prompt.git
```

**方式三：本地目录（开发时）**

```sh
dsh plugin --profile <你的 profile> add /绝对路径/yujie-dsh-plugin-system-prompt
```

安装完成后，Plugins → **Installed** 里会出现 `yujie-dsh-plugin-system-prompt`。若页面之前一直开着，刷新一次浏览器。

## 使用

1. 打开左侧栏 **Plugins**，点顶部的 **系统提示词** Tab（或 Settings → 内置插件 → 系统提示词）。
2. 在文本框里写你的系统提示词，按「保存」。
3. 从下一次请求开始，所有对话的系统提示词开头都会带上这段文字。

例：

```text
你是一名资深 Go 工程师。始终用简体中文回答，先给结论，再给可运行的代码示例，优先使用标准库。
```

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | `""` | 注入的系统提示词正文；为空时不注入。 |
| `enabled` | boolean | `true` | 是否注入；关闭后保留文本但不生效。 |

两个字段都声明为 volatile，因此会出现在 Host 设置表单中并支持热更新，最终持久化到当前 profile 的 `cordis.patch.yml`：

```yaml
- id: yujie-dsh-plugin-system-prompt
  config:
    prompt: '你是一名资深 Go 工程师……'
    enabled: true
```

## 工作原理

- **Host 半**（[index.js](index.js)）：通过 `ctx.systemPrompt.section()` 注册一个 order 为 `-999` 的 section（紧跟固定身份 `-1000` 之后、内置指引之前）。section 文本是一个函数，每次组装系统提示词时读取 `prompt` / `enabled` 的当前值，因此配置变化立即反映到下一次请求。
- **Client 半**（[client.js](client.js)）：把同一张配置卡片注册到 `plugins.tab`（Plugins 页面 Tab）、`settings.plugins.tab`（Settings → 内置插件 Tab）和 `plugins.bundle.config`（bundle 详情页配置区）。卡片是文本框 + 开关 + 保存按钮；读写通过 `ctx.configForms.get('<entry id>')`，即 Host 设置服务，带 revision 校验，避免并发覆盖。
- **配置链路**：volatile Config 字段 → Host 设置服务 → 写入 profile patch；插件每次组装时读实时值，所以无需重启。
- 注入内容不写入用户消息历史，只作为派生的系统提示词节点存在。

## 仓库结构

```text
.
├── index.js            # Host 半：注册 system-prompt section，读取 volatile 配置
├── client.js           # Client 半：三处配置卡片（Plugins Tab / Settings Tab / bundle 页）
├── cordis.patch.yml    # bundle patch：插入 Host 行
├── package.json        # 包清单、dsh.bundle / dsh.client 声明
├── locale/
│   ├── en.json         # 插件显示名与描述（英文）
│   └── zh.json         # 插件显示名与描述（中文）
├── icon.svg            # 插件图标
├── pnpm-lock.yaml      # 依赖锁定
└── README.md
```

## 开发

```sh
pnpm install          # 安装 @deepseek-ai/schemastery（与 DSH 内置版本 3.18.5 对齐）
```

- 以本地目录方式（`link:`）安装时，插件消费本目录的 `node_modules`；移动或重新 checkout 后需要再跑一次 `pnpm install`。
- 修改 **Client 半**（`client.js`）通常会被客户端热载接管；修改 **Host 半**（`index.js`）后，需要重载该插件行或重启 DSH 才会加载新代码。
- 面板文案在 [client.js](client.js) 内的 `en` / `zh` 字典中；插件显示名与描述在 `locale/*.json` 的 `meta` 中。

## 已知限制

- 只影响系统提示词，不改动用户消息；也不做变量插值（`interpolate: false`）。
- 系统提示词变化会导致该前缀之后的 KV cache 复用失效，属于预期成本。
- 表单是整体提交：保存时同时写入 `prompt` 和 `enabled`。

## License

未指定。如需开源授权，请在仓库中补充 `LICENSE` 文件。

---

<a id="english"></a>
# English

A [DeepSeek Harness](https://www.deepseek.com/harness/) (DSH) plugin that injects your own text at the **very beginning** of every conversation's system prompt. The text is edited directly from the **plugin management panel**.

[简体中文](#yujie-dsh-plugin-system-prompt) | English

## Features

- **Custom system prompt** — takes effect from the next model step, for every session and every agent (subagents included).
- **Hot updates** — no Harness restart, and the current conversation is not interrupted.
- **Three edit entry points**, all inside the management panel (any one works):
  - a **System prompt** tab on the Plugins page, after `Installed / Discover`;
  - a **System prompt** tab under Settings → **Built-in plugins**;
  - the configuration area on the bundle's detail page, between its description and its rows.
- **Switch and clear** — untick "Inject this prompt" to turn it off temporarily; clear the text and save to remove the injection entirely.
- **Fixed position** — right after the fixed Harness identity and ahead of the built-in guidance (system-prompt section order `-999`).
- **No interpolation** — the text is injected literally, so `{{...}}` is safe.
- **Persistent** — the configuration is written to the active profile's `cordis.patch.yml` and survives restarts.
- **Bilingual UI** — the panel copy follows the active DSH locale (Simplified Chinese / English).

Verified on DeepSeek Harness `0.2.1-rc.5` (macOS Desktop): the injected text appears in the system prompt the model actually receives.

## Installation

Requires DeepSeek Harness `0.2.1` or newer (Web or Desktop).

**Option 1: install inside DSH (recommended)**

Open **Plugins** in the sidebar → **Add plugin**, then install this repository:

```
git+https://github.com/yujieco/yujie-dsh-plugin-system-prompt.git
```

**Option 2: command line**

```sh
dsh plugin --profile <your profile> add git+https://github.com/yujieco/yujie-dsh-plugin-system-prompt.git
```

**Option 3: local directory (development)**

```sh
dsh plugin --profile <your profile> add /absolute/path/to/yujie-dsh-plugin-system-prompt
```

After installation, `yujie-dsh-plugin-system-prompt` shows up under Plugins → **Installed**. If the page was already open, refresh the browser once.

## Usage

1. Open **Plugins** in the sidebar and select the **System prompt** tab (or Settings → Built-in plugins → System prompt).
2. Write your system prompt and press **Save**.
3. From the next request on, every conversation's system prompt starts with that text.

Example:

```text
You are a senior Go engineer. Always answer in Simplified Chinese, lead with the conclusion, then give runnable code, preferring the standard library.
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `prompt` | string | `""` | The text to inject; nothing is injected while it is empty. |
| `enabled` | boolean | `true` | Whether to inject; turning it off keeps the text without applying it. |

Both fields are declared volatile, so they appear in the Host settings form, update live, and persist to the active profile's `cordis.patch.yml`:

```yaml
- id: yujie-dsh-plugin-system-prompt
  config:
    prompt: 'You are a senior Go engineer…'
    enabled: true
```

## How it works

- **Host half** ([index.js](index.js)) registers a single `ctx.systemPrompt.section()` at order `-999`, directly after the fixed Harness identity (`-1000`) and before the built-in guidance. Its text is a function, so every prompt assembly reads the current `prompt` / `enabled` values — configuration changes reach the next request immediately.
- **Client half** ([client.js](client.js)) registers the same configuration card into `plugins.tab` (Plugins page tab), `settings.plugins.tab` (Settings → Built-in plugins tab), and `plugins.bundle.config` (bundle detail page). The card is a textarea, a switch, and a save button; reads and writes go through `ctx.configForms.get('<entry id>')` (the Host settings service) with revision checks, so concurrent edits are not silently overwritten.
- **Configuration path**: volatile Config fields → Host settings service → profile patch; the plugin reads live values on every assembly, hence no restart.
- Injected text is not written into the user message history; it exists only as a derived system-prompt node.

## Repository layout

```text
.
├── index.js            # Host half: registers the system-prompt section, reads volatile config
├── client.js           # Client half: the three configuration surfaces
├── cordis.patch.yml    # Bundle patch: inserts the Host row
├── package.json        # Package manifest, dsh.bundle / dsh.client declarations
├── locale/
│   ├── en.json         # Plugin display name and description (English)
│   └── zh.json         # Plugin display name and description (Chinese)
├── icon.svg            # Plugin icon
├── pnpm-lock.yaml      # Locked dependency
└── README.md
```

## Development

```sh
pnpm install          # installs @deepseek-ai/schemastery (aligned with the DSH-bundled 3.18.5)
```

- With a local-directory (`link:`) installation the plugin uses this directory's `node_modules`; run `pnpm install` again after moving or re-checking-out the directory.
- Changes to the **Client half** (`client.js`) are normally picked up by the client hot reload; changes to the **Host half** (`index.js`) require reloading the plugin row or restarting DSH to load the new code.
- Panel copy lives in the `en` / `zh` dictionaries inside [client.js](client.js); the plugin display name and description live under `meta` in `locale/*.json`.

## Known limitations

- System prompt only — user messages are untouched. No variable interpolation (`interpolate: false`).
- Changing the system prompt invalidates KV-cache reuse from the first changed token; that is an expected cost.
- The form saves as one unit: `prompt` and `enabled` are written together.

## License

Not specified. Add a `LICENSE` file if you intend to grant an open-source license.
