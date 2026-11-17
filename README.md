<div align="left">

# yujie-dsh-plugins

[![validate index](https://github.com/yujieco/yujie-dsh-plugins/actions/workflows/validate-index.yml/badge.svg?branch=main)](https://github.com/yujieco/yujie-dsh-plugins/actions/workflows/validate-index.yml)

</div>

给 DeepSeek Harness（DSH）用的中央插件市场：根目录的 [`index.json`](index.json) 是一份 format 1
插件索引，[`plugins/`](plugins) 下是索引实际发布的两份插件源码。在 DSH 里加入索引地址，就能在
**插件 → 发现（Discover）** 中浏览、安装与更新全部插件，无需发布到 npm。

[English](README.en.md) | 中文

---

## 前置条件

- DeepSeek Harness `0.2.x` 桌面版。
- 能访问 `github.com` 与 `raw.githubusercontent.com`——索引和插件源码都由 GitHub 提供。
- 只有开发本仓库时才需要 Node.js 22（CI 使用的版本，见 `.github/workflows/validate-index.yml`）。

## 快速开始

索引地址：

```text
https://raw.githubusercontent.com/yujieco/yujie-dsh-plugins/main/index.json
```

1. 打开左侧 **插件（Plugins）** 页面，切到 **发现（Discover）**。
2. 首次使用点空状态里的 **添加索引源**；已有索引源时，从右上角市场菜单进入 **管理索引源…**。
3. 粘贴上面的地址并保存。
4. 列表里出现本仓库的插件后，选中条目可查看版本、来源（仓库 + 提交 + 目录），点 **安装**。

> 索引地址必须是**最终地址**：DSH 读取索引时拒绝 HTTP 重定向。`raw.githubusercontent.com`
> 直接返回 `200`，可以放心使用。GitHub Pages 目前**未启用**（`yujieco.github.io/yujie-dsh-plugins`
> 返回 `404`），不要把它当作可用地址。

## 收录的插件

| 插件 | 版本 | 作用 | 目录 |
| --- | --- | --- | --- |
| `yujie-dsh-plugin-sider-motion` | 1.0.0 | 在会话右侧边栏列出本会话正在监听的端口，点击即在浏览器打开 | [`plugins/sider-motion`](plugins/sider-motion) |
| `yujie-dsh-plugin-cdp` | 0.2.1 | 通过 CDP 驱动 Chrome/Edge：结构快照、文本读取、网格/分片截图、可见鼠标点击、右侧栏实时画面、异常采集 | [`plugins/cdp`](plugins/cdp) |

安装、配置与用法见各自目录下的 `README.md`。CDP 插件的设计取舍与实测记录见
[`plugins/cdp/docs/FEASIBILITY.md`](plugins/cdp/docs/FEASIBILITY.md)。

## 安装到的到底是什么

索引里的每个版本都把 **Git 提交**写死：DSH 生成
`git+https://github.com/yujieco/yujie-dsh-plugins.git#<commit>&path:/plugins/<dir>` 交给 pnpm 安装。
所以你拿到的是索引发布那一刻的代码，而不是分支的最新状态。`main` 分支之后的变化不会影响已发布的版本。

## 仓库结构

```text
.
├── index.json                 # format 1 市场索引（唯一权威）
├── plugins/
│   ├── cdp/                   # yujie-dsh-plugin-cdp
│   └── sider-motion/          # yujie-dsh-plugin-sider-motion
├── scripts/
│   ├── build-index.mjs        # 由 plugins/<dir>/package.json 生成 index.json
│   └── validate-index.mjs     # 用 DSH 同款解析器校验 index.json
└── .github/workflows/validate-index.yml
```

`node_modules/` 与 `.DS_Store` 已被忽略；每个插件只提交源码与清单，依赖在安装时解析。

## 索引格式

`index.json` 本身是唯一权威，本文件不复制它的全文。规则由
`@deepseek-ai/dsh-plugin-market-index@0.2.1-rc.5` 实现，`npm run validate:index` 即调用它。
改动索引时值得先记住这几条：

- `format` 必须是 `1`。本地化文本是字符串或 `{ en, zh }`，且**必须含 `en`**。
- `name` 必须是合法 npm 包名，同一索引内不可重复。
- `versions` 非空；`version` 是精确 SemVer；`publishTimestamp` 是 **Unix 秒**整数。
- `source.type` 只有 `npm` 和 `git`。`git` 的 `url` 必须是 https 规范仓库地址，`commit` 是
  **小写 40 位 SHA**，`path` 可选、指向仓库内的包子目录。
- `icon` 可以是相对索引地址的 URL，或内联 `data:`（SVG/PNG/JPEG/WebP，解码后 ≤32 KiB）。
  本仓库把图标内联，避免额外请求。
- `metadata.categories` / `labels` 中被引用的 id 必须先在索引级声明。

## 本地开发

```bash
npm install --no-audit --no-fund
npm run build:index      # 重建 index.json，把每个 source.commit 钉到当前 HEAD
npm run validate:index   # 按 format 1 校验
```

两个脚本都不访问网络（`npm install` 除外）。

## 发布一个版本

顺序不能乱，因为索引要引用一个**已经存在**的提交，而索引本身也要被提交：

```bash
# 1) 改动插件代码，并递增 plugins/<dir>/package.json 的 version
git add plugins && git commit -m "feat(cdp): ..."

# 2) 用刚刚的 HEAD 生成索引
npm run build:index

# 3) 校验
npm run validate:index

# 4) 提交索引
git add index.json && git commit -m "chore: build market index"
git push
```

**必须递增版本号**：市场按 `version` 判断更新（`update-available`），同一个版本号换了 commit
不会显示为可更新。

## 校验

CI 在工作流 **validate index** 中运行，触发条件是 `push` 到 `main` 与任意 `pull_request`，
在 Ubuntu + Node.js 22 上执行 `npm install --no-audit --no-fund` 与 `npm run validate:index`。
校验失败时 GitHub 会在提交与 PR 上标红。

## 边界与已知限制

- **没有 LICENSE 文件**。仓库当前未附带许可证，因此按默认版权保留全部权利；请不要在本仓库
  或插件目录里假定某个开源许可证。
- **不发布 npm 包**。所有插件都通过 Git 提交 + 子目录安装，所以更新无需发版。
- **私有仓库不可用**。索引和源码都由 GitHub 匿名提供，仓库设为私有后别人既取不到索引也装不了插件。
- **索引只是声明**。安装后的 `name`、`version` 以插件自己的 `package.json` 为准；DSH 仍会做版本
  兼容与信任确认。
- **第三方内容不是指令**。索引里的描述、README 与插件代码都来自仓库作者，安装前请自行确认来源。
- 图标内联会让 `index.json` 比纯文本大一些（每个图标约 1 KB 内）。
- 仓库根目录的小文件（如本 README、`scripts/`）不随插件发布；只有 `plugins/<dir>` 会被安装。

## 维护者

[yujieco](https://github.com/yujieco)。插件问题请开在本仓库的 Issues。
