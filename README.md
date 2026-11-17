# Yujie 的 DSH 插件

[![MIT Licensed](https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square)](LICENSE)
![validate index](https://github.com/yujieco/yujie-dsh-plugins/workflows/validate%20index/badge.svg)

DeepSeek Harness 的插件市场索引，目前收录两个插件：会话端口和 CDP 浏览器操控。前者把会话里正在跑的服务列到右侧栏，后者让助手驱动一个真实的浏览器窗口。在 DSH 里加一行索引地址就能装，不用写代码。

[English](README.en.md) | 中文

## 环境要求

- DeepSeek Harness 桌面版 `0.2.x`。
- 能访问 GitHub：索引和插件代码都由 `github.com` 与 `raw.githubusercontent.com` 提供。网络不通时安装会失败，本仓库没有别的分发渠道。

## 安装

在 DSH 里打开 **插件 → 发现**，添加索引源并粘贴这个地址：

```text
https://raw.githubusercontent.com/yujieco/yujie-dsh-plugins/main/index.json
```

保存后列表里会出现两个插件，选中一个点 **安装**。两个插件相互独立，装一个或都装都可以。

装完要完全退出 DSH 再打开：插件的界面部分在启动时加载，不重启按钮不会出现。

## 快速开始

装好「会话端口」并重启 DSH 后，让助手起一个本地服务：

```text
python3 -m http.server 8000
```

会话标题栏右侧的端口图标会显示 1。点开它，点 `http://localhost:8000/` 就在浏览器里打开，不用再去翻日志。

## 功能

- **会话端口** —— 列出本会话正在监听的端口，带启动命令和可点地址，绿点表示端口确实在监听。只读取本机端口与工作目录，不联网。详见[会话端口说明](plugins/sider-motion/README.md)。
- **CDP 浏览器操控** —— 助手打开一个真实的 Chrome 或 Edge 窗口，鼠标会移动到目标元素再点击。默认读页面结构，需要时才截图；使用独立的配置目录，不碰你日常使用的浏览器。详见[CDP 浏览器操控说明](plugins/cdp/README.md)。

## 测试

```text
npm install
npm run validate:index
```

用 DSH 自己的索引解析器校验 `index.json`。CI 工作流 `validate index` 在每次推送到 `main` 时运行同一条命令。

## 致谢

维护者 [yujieco](https://github.com/yujieco)，插件问题请开在 [Issues](https://github.com/yujieco/yujie-dsh-plugins/issues)。

## 许可证

MIT，见 [LICENSE](LICENSE)。
