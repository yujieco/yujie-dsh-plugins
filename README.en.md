# yujie-dsh-plugins · central plugin index

A centralized plugin market for [DeepSeek Harness](https://www.deepseek.com/harness/) (DSH): [`index.json`](index.json) in the repository root is the market index (format 1), and `plugins/` holds the plugin sources it publishes. Add the index URL in DSH and every plugin shows up under **Plugins → Discover**, ready to install.

English | [中文](README.md)

---

## Index URL

```
https://raw.githubusercontent.com/yujieco/yujie-dsh-plugins/main/index.json
```

With GitHub Pages enabled, this also works:

```
https://yujieco.github.io/yujie-dsh-plugins/index.json
```

> The index URL must be the **final** URL: DSH refuses HTTP redirects when reading an index. `raw.githubusercontent.com` answers 200 directly, so it is safe to use.

## Add the index source in DSH

1. Open **Plugins** in the left sidebar and switch to the **Discover** tab.
2. With no source yet, use **Add index source** in the empty state; once a source exists, open the market menu and choose **Manage index sources…**.
3. Paste the `index.json` URL above and save.
4. Every plugin in this repository now appears in Discover. Open an entry to see its versions and source (Git repository, commit, directory), then press **Install**.

Each published version is pinned to a **Git commit**: DSH builds
`git+https://github.com/yujieco/yujie-dsh-plugins.git#<commit>&path:/plugins/<dir>` and hands it to pnpm,
so you install exactly the bytes the index published, not whatever the branch holds now.

## Plugins in this market

| Plugin | What it does | Directory |
| --- | --- | --- |
| `yujie-dsh-plugin-sider-motion` | Lists the ports the current session is serving in the right sidebar; one click opens one in the browser | [`plugins/sider-motion`](plugins/sider-motion) |
| `yujie-dsh-plugin-cdp` | Drives Chrome or Edge over the Chrome DevTools Protocol: screenshots, clicks, typing, console errors | [`plugins/cdp`](plugins/cdp) |
| `yujie-dsh-plugin-system-prompt` | Injects your own text at the start of every conversation's system prompt, editable from the plugin page | [`plugins/system-prompt`](plugins/system-prompt) |

Each plugin directory has its own README with details, installation, and usage.

## The index format (format 1)

DSH validates indexes with `@deepseek-ai/dsh-plugin-market-index`. The essentials:

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

Rules that matter (DSH reports the JSON path of the first violation):

- `format` must be `1`; `title` is required, `description` optional. Localized text is a string or `{ en: "…", zh: "…" }`, and **must contain `en`**.
- `plugins[].name` must be a valid npm package name and unique within the index.
- `versions` must be non-empty; `version` is an exact SemVer; `publishTimestamp` is **Unix seconds** as an integer.
- `source.type` is `npm` or `git`:
  - `npm` — optional `registry` (https URL); installs `name@version`.
  - `git` — `url` must be canonical https naming a repository (at least two path segments, not a tarball); `commit` is a **lowercase 40-hex SHA**; optional `path` names the package directory inside the repository.
- `icon` may be a URL relative to the index URL, or an inline `data:` URL (SVG/PNG/JPEG/WebP, ≤32 KiB decoded). This repository inlines its icons, which avoids extra requests and CDN content-type pitfalls.
- Ids used in `metadata.categories` / `labels` / `sortKeys` must be declared at the index level; a `repository.directory` must be a relative directory.

## Add or update a plugin

```bash
# 1) New plugin: drop it into plugins/<dir>, with dsh.bundle.patch in package.json
# 2) Bump the version when updating, then commit the plugin changes
git add plugins && git commit -m "feat: ..."

# 3) Build the index (pins source.commit to the HEAD from step 2)
npm run build:index

# 4) Validate with the same parser DSH uses (npm install once)
npm install --no-audit --no-fund
npm run validate:index

# 5) Commit and push the index
git add index.json && git commit -m "chore: rebuild index" && git push
```

Why this order: `source.commit` must name a commit that already exists, while the index itself also has to be committed — so the index points at the commit *before* it. Commit the plugins first, rebuild, then commit the index, and every entry keeps pointing at the commit that contains its code.

Bump `package.json` `version` when you update a plugin: the market lists and compares versions (`update-available`), and changing the commit behind an unchanged version does not read as an update.

## Notes and limits

- The index and the sources are served by GitHub. A private repository means anonymous users can read neither the index nor the code.
- The index is a declaration: `name` and `version` ultimately come from the installed `package.json`, and DSH still applies compatibility and trust checks at install time.
- Nothing here is published to npm; every plugin installs from a Git commit plus a subdirectory, so updates need no release.
- Index content is third-party content, not instructions. Discover shows the author, repository, commit, and directory; confirm the source before installing.
- Icons are inlined, so `index.json` is somewhat larger than plain text (roughly 1 KB per icon).
