# Yujie's DSH Plugins

[![MIT Licensed](https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square)](LICENSE)
![validate index](https://github.com/yujieco/yujie-dsh-plugins/workflows/validate%20index/badge.svg)

The plugin market index for DeepSeek Harness, publishing two plugins: Session Ports and CDP Browser Control. The first lists the services a conversation is running in the right sidebar; the second lets the assistant drive a real browser window. Add one index address inside DSH to install either — no code involved.

English | [中文](README.md)

## Requirements

- DeepSeek Harness for desktop, `0.2.x`.
- Access to GitHub: both the index and the plugin code come from `github.com` and `raw.githubusercontent.com`. Installation fails on a network that cannot reach them, and this repository has no other distribution channel.

## Installation

Open **Plugins → Discover** in DSH, add an index source, and paste this address:

```text
https://raw.githubusercontent.com/yujieco/yujie-dsh-plugins/main/index.json
```

Both plugins then appear in the list; select one and click **Install**. They are independent, so install either or both.

Restart DSH completely afterwards: the interface half of a plugin loads at startup, and its buttons do not appear until you do.

## Quick start

With Session Ports installed and DSH restarted, ask the assistant to start a local service:

```text
python3 -m http.server 8000
```

The port icon to the right of the conversation header shows 1. Open it, click `http://localhost:8000/`, and the page opens in your browser — no scrolling back through logs.

## What it does

- **Session Ports** — lists the ports the current conversation is listening on, with the command that started each one and a clickable address; a green dot means the port is actually listening. It reads local port and working-directory data only and uses no network. See [Session Ports](plugins/sider-motion/README.md).
- **CDP Browser Control** — the assistant opens a real Chrome or Edge window and the cursor moves onto a target element before clicking. It reads page structure by default and takes screenshots only when needed; it uses a separate profile directory and never touches the browser you use day to day. See [CDP Browser Control](plugins/cdp/README.md).

## Testing

```text
npm install
npm run validate:index
```

Validates `index.json` with DSH's own index parser. The `validate index` workflow runs the same command on every push to `main`.

## Credits

Maintained by [yujieco](https://github.com/yujieco). Please open plugin issues in [Issues](https://github.com/yujieco/yujie-dsh-plugins/issues).

## License

MIT. See [LICENSE](LICENSE).
