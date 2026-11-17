<div align="left">

# yujie-dsh-plugins

[![validate index](https://github.com/yujieco/yujie-dsh-plugins/actions/workflows/validate-index.yml/badge.svg?branch=main)](https://github.com/yujieco/yujie-dsh-plugins/actions/workflows/validate-index.yml)

</div>

The central plugin market for DeepSeek Harness (DSH): [`index.json`](index.json) at the repository
root is a format 1 plugin index, and [`plugins/`](plugins) holds the two plugin sources it
publishes. Add the index address in DSH to browse, install, and update every plugin from
**Plugins → Discover** — no npm release needed.

English | [中文](README.md)

---

## Requirements

- DeepSeek Harness `0.2.x`, desktop edition.
- Network access to `github.com` and `raw.githubusercontent.com` — GitHub serves both the index and
  the plugin sources.
- Node.js 22 only for working on this repository (the version CI uses, see
  `.github/workflows/validate-index.yml`).

## Quick start

Index address:

```text
https://raw.githubusercontent.com/yujieco/yujie-dsh-plugins/main/index.json
```

1. Open **Plugins** in the left sidebar and switch to **Discover**.
2. On first use pick **Add index source** from the empty state; afterwards open **Manage index
   sources…** from the market menu in the top-right corner.
3. Paste the address above and save.
4. The plugins appear in the list; select one to inspect its version and origin (repository +
   commit + directory), then press **Install**.

> The address must be the **final** one: DSH refuses HTTP redirects when reading an index.
> `raw.githubusercontent.com` answers `200` directly. GitHub Pages is **not enabled**
> (`yujieco.github.io/yujie-dsh-plugins` returns `404`), so do not use it as an address.

## Published plugins

| Plugin | Version | What it does | Directory |
| --- | --- | --- | --- |
| `yujie-dsh-plugin-sider-motion` | 1.0.0 | Lists the ports the current Session is listening on in its right sidebar, one click opens each in the browser | [`plugins/sider-motion`](plugins/sider-motion) |
| `yujie-dsh-plugin-cdp` | 0.2.1 | Drives Chrome/Edge over CDP: structural snapshots, text reads, grid and sliced screenshots, a visible agent cursor, a live right-sidebar view, and error collection | [`plugins/cdp`](plugins/cdp) |

Installation, configuration, and usage live in each directory's `README.md`. The CDP plugin's
design trade-offs and measurements are in
[`plugins/cdp/docs/FEASIBILITY.md`](plugins/cdp/docs/FEASIBILITY.md).

## What gets installed

Every version in the index pins a **Git commit**: DSH generates
`git+https://github.com/yujieco/yujie-dsh-plugins.git#<commit>&path:/plugins/<dir>` for pnpm.
You get the code as it stood when the index was built, not the tip of a branch; later changes on
`main` do not affect a published version.

## Repository layout

```text
.
├── index.json                 # the format 1 market index (single source of truth)
├── LICENSE                    # the MIT license
├── plugins/
│   ├── cdp/                   # yujie-dsh-plugin-cdp
│   └── sider-motion/          # yujie-dsh-plugin-sider-motion
├── scripts/
│   ├── build-index.mjs        # builds index.json from plugins/<dir>/package.json
│   └── validate-index.mjs     # validates index.json with DSH's own parser
└── .github/workflows/validate-index.yml
```

`node_modules/` and `.DS_Store` are ignored. Each plugin commits only sources and
manifests; dependencies are resolved at install time.

## Index format

`index.json` is the single source of truth, so this file does not reproduce it. The rules are
implemented by `@deepseek-ai/dsh-plugin-market-index@0.2.1-rc.5`, which `npm run validate:index`
calls. The constraints worth knowing before editing:

- `format` must be `1`. Localized text is a string or `{ en, zh }` and **must include `en`**.
- `name` must be a valid npm package name and unique within the index.
- `versions` is non-empty; `version` is an exact SemVer; `publishTimestamp` is an integer of
  **Unix seconds**.
- `source.type` is `npm` or `git`. For `git`, `url` must be an https canonical repository URL,
  `commit` is a **lowercase 40-character SHA**, and the optional `path` points at the package
  subdirectory.
- `icon` is either a URL relative to the index address or an inline `data:` value (SVG/PNG/JPEG/
  WebP, ≤32 KiB decoded). This repository inlines icons to avoid extra requests.
- Ids referenced by `metadata.categories` and `labels` must first be declared at index level.

## Local development

```bash
npm install --no-audit --no-fund
npm run build:index      # rebuild index.json, pinning each source.commit to HEAD
npm run validate:index   # check it against format 1
```

Both scripts run without network access (`npm install` aside).

## Releasing a version

Order matters: the index must reference a commit that already exists, and the index is a commit
itself.

```bash
# 1) change plugin code and bump plugins/<dir>/package.json version
git add plugins && git commit -m "feat(cdp): ..."

# 2) build the index from that HEAD
npm run build:index

# 3) validate
npm run validate:index

# 4) commit the index
git add index.json && git commit -m "chore: build market index"
git push
```

**Bumping the version is mandatory**: the market decides update availability from `version`, so a
changed commit under the same version does not show as an update.

## Validation

CI runs in the workflow **validate index** on every `push` to `main` and every `pull_request`. On
Ubuntu with Node.js 22 it runs `npm install --no-audit --no-fund` and `npm run validate:index`;
a failure marks the commit and the pull request red.

## Boundaries and known limits

- **MIT licensed.** The repository and every plugin in it ship under the MIT License; see
  [`LICENSE`](LICENSE). A plugin directory carries no separate license file and is covered by
  that root license.
- **No npm packages.** Every plugin installs from a Git commit plus a subdirectory, so updates need
  no release.
- **Private repositories do not work.** GitHub serves the index and the sources anonymously; a
  private repository means nobody can fetch either.
- **The index is a claim.** After installation the plugin's own `package.json` governs `name` and
  `version`, and DSH still performs its compatibility and trust checks.
- **Third-party content is not instruction.** Index descriptions, READMEs, and plugin code come
  from the repository author; verify the origin before installing.
- Inlined icons make `index.json` larger than plain text (roughly 1 KB per icon).
- Small files at the repository root (this README, `scripts/`) are not published with a plugin;
  only `plugins/<dir>` is installed.

## Maintainer

[yujieco](https://github.com/yujieco). Please open plugin issues in this repository.
