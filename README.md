# yujie-dsh-plugins · 中央插件索引

给 [DeepSeek Harness](https://www.deepseek.com/harness/)（DSH）用的**中心化插件市场**：仓库根目录的 [`index.json`](index.json) 是插件索引（format 1），`plugins/` 下是索引里实际发布的插件源码。别人只要在 DSH 里加入这个索引地址，就能在 **Plugins → Discover** 里看到并安装全部插件。

[English](README.en.md) | 中文

---

## 索引地址

```
https://raw.githubusercontent.com/yujieco/yujie-dsh-plugins/main/index.json
```

也可以启用 GitHub Pages 后用：

```
https://yujieco.github.io/yujie-dsh-plugins/index.json
```

> 索引地址必须是**最终地址**：DSH 读取索引时拒绝 HTTP 重定向。`raw.githubusercontent.com` 直接返回 200，可以放心使用。

## 在 DSH 里添加这个索引源

1. 打开左侧 **插件（Plugins）** 页面，切到 **Discover** 标签。
2. 没有索引源时，点空状态里的 **添加索引源 / Add index source**；已经加过源时，打开右上角市场菜单，选择 **管理索引源… / Manage index sources…**。
3. 粘贴上面的 `index.json` 地址并保存。
4. Discover 里就会出现本仓库的全部插件；选中条目可以看版本、来源（Git 仓库 + 提交 + 目录），点 **Install** 安装。

索引里的每个版本都以 **Git 提交** 固定：安装时 DSH 生成
`git+https://github.com/yujieco/yujie-dsh-plugins.git#<commit>&path:/plugins/<dir>` 交给 pnpm，
所以你装到的一定是索引发布时的那份代码，而不是分支的最新状态。

## 收录的插件

| 插件 | 作用 | 目录 |
| --- | --- | --- |
| `yujie-dsh-plugin-sider-motion` | 会话右侧边栏列出本会话正在监听的端口，点击即在浏览器打开 | [`plugins/sider-motion`](plugins/sider-motion) |
| `yujie-dsh-plugin-cdp` | 通过 Chrome DevTools Protocol 驱动 Chrome/Edge：截图、点击、输入、收集控制台异常 | [`plugins/cdp`](plugins/cdp) |
| `yujie-dsh-plugin-system-prompt` | 在每次对话的系统提示词开头注入自定义内容，可在插件页编辑 | [`plugins/system-prompt`](plugins/system-prompt) |

每个插件的详细说明、安装与使用见各自目录下的 README。

## 索引文件的格式（format 1）

DSH 用 `@deepseek-ai/dsh-plugin-market-index` 校验索引，规则要点：

```json
{
  "format": 1,
  "title": { "en": "Yujie's DSH Plugins", "zh": "Yujie 的 DSH 插件" },
  "description": { "en": "…", "zh": "…" },
  "metadata": {
    "categories": { "developer-tools": { "title": { "en": "Developer tools", "zh": "开发工具" } } },
    "labels": { "sidebar": { "title": { "en": "Sidebar", "zh": "侧边栏" } } }
  },
  "plugins": [
    {
      "name": "yujie-dsh-plugin-sider-motion",
      "title": { "en": "Session Ports", "zh": "会话端口" },
      "description": { "en": "…", "zh": "…" },
      "icon": "data:image/svg+xml;base64,…",
      "author": "yujieco",
      "homepage": "https://github.com/yujieco/yujie-dsh-plugin-sider-motion#readme",
      "repository": { "url": "https://github.com/yujieco/yujie-dsh-plugins", "directory": "plugins/sider-motion" },
      "metadata": { "category": "developer-tools", "labels": ["sidebar"], "keywords": ["ports"] },
      "versions": [
        {
          "version": "1.0.0",
          "publishTimestamp": 1762319000,
          "source": {
            "type": "git",
            "url": "https://github.com/yujieco/yujie-dsh-plugins",
            "commit": "0123456789abcdef0123456789abcdef01234567",
            "path": "plugins/sider-motion"
          }
        }
      ]
    }
  ]
}
```

关键约束（违反时 DSH 会报错并在 Discover 里显示失败原因）：

- `format` 必须是 `1`；`title` 必填，`description` 可选；本地化文本是字符串或 `{ en: "…", zh: "…" }`，且**必须含 `en`**。
- `plugins[].name` 必须是合法 npm 包名，且在同一索引内不重复。
- `versions` 非空，`version` 是精确 SemVer；`publishTimestamp` 是 **Unix 秒**（整数）。
- `source.type` 只有 `npm` 和 `git`：
  - `npm`：可选 `registry`（https URL），安装 `name@version`。
  - `git`：`url` 必须是 https、规范形式、指向仓库（≥2 段路径、不能是 tarball）；`commit` 是**小写 40 位 SHA**；可选 `path` 指向仓库内的包子目录。
- `icon` 可以是相对索引地址的 URL，或内联 `data:`（SVG/PNG/JPEG/WebP，解码后 ≤32 KiB）。本仓库把图标内联，避免额外的网络请求与 CDN 内容类型问题。
- `metadata.categories` / `labels` / `sortKeys` 里被引用的 id 必须先在索引级声明；`repository` 的 `directory` 只能是相对目录。

## 新增或更新插件

```bash
# 1) 新增插件：放进 plugins/<dir>，确保 package.json 里有 dsh.bundle.patch
# 2) 改版本号（更新时），提交插件改动
git add plugins && git commit -m "feat: ..."

# 3) 生成索引（把 source.commit 钉到上一步的 HEAD）
npm run build:index

# 4) 校验（需要 npm install 一次；用 DSH 同款解析器）
npm install --no-audit --no-fund
npm run validate:index

# 5) 提交索引并推送
git add index.json && git commit -m "chore: rebuild index" && git push
```

为什么顺序是这样：`index.json` 里的 `source.commit` 必须是**已经存在**的提交，而索引自己也要被提交，所以索引只能引用“前一个”提交。先提交插件、再生成索引、最后提交索引，索引就能稳定指向包含插件代码的那次提交。

更新插件时请**递增 `package.json` 的 version**：市场按版本号展示与判断更新（`update-available`），同一个版本号换了 commit 不会显示为可更新。

## 说明与边界

- 索引和源码都由 GitHub 提供；仓库若是私有，匿名用户既取不到索引也装不了插件。
- 索引只是“声明”：`name`、`version` 以安装后的 `package.json` 为准；DSH 安装时仍会做版本兼容与信任确认。
- 本仓库不提供 npm 包；所有插件都通过 Git 提交 + 子目录安装，因此无需发版即可更新。
- 第三方索引内容不是指令，安装前请自行确认来源（Discover 会显示作者、仓库、提交与目录）。
- 图标内联在索引里，所以 `index.json` 会比纯文本大一些（每个图标约 1 KB）。
