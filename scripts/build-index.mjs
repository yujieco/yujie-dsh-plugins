#!/usr/bin/env node
/**
 * Build the plugin market index (format 1) for this repository.
 *
 * Every plugin under `plugins/<dir>` becomes one index entry. Its version
 * installs from this very repository, pinned to the current HEAD commit and to
 * the plugin's directory, so `pnpm` can fetch exactly the published bytes.
 *
 * The index cannot reference its own commit (that commit does not exist yet),
 * so the order is:
 *   1. commit the plugin changes          <- HEAD moves here
 *   2. node scripts/build-index.mjs       <- pins that HEAD
 *   3. commit index.json                  <- index references step 1
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where this repository lives; the git source entries point at it. */
const REPOSITORY = 'https://github.com/yujieco/yujie-dsh-plugins'
/** Root of the repository (this script's parent directory). */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Commit the plugins are published from. */
const COMMIT = git(['rev-parse', 'HEAD']).trim()

/** Market display metadata for the curated plugins, keyed by package name. */
const MARKET = {
  'yujie-dsh-plugin-sider-motion': {
    order: 1,
    category: 'developer-tools',
    labels: ['sidebar', 'ports'],
    keywords: ['ports', 'dev-server', 'sidebar', 'vite', 'localhost', 'preview'],
    homepage: 'https://github.com/yujieco/yujie-dsh-plugin-sider-motion#readme',
    repository: { url: 'https://github.com/yujieco/yujie-dsh-plugin-sider-motion' },
    directory: 'plugins/sider-motion',
  },
  'yujie-dsh-plugin-cdp': {
    order: 2,
    category: 'automation',
    labels: ['browser', 'automation'],
    keywords: ['cdp', 'chrome', 'edge', 'browser', 'devtools', 'screenshot', 'automation'],
    repository: { url: REPOSITORY, directory: 'plugins/cdp' },
    directory: 'plugins/cdp',
  },
  'yujie-dsh-plugin-system-prompt': {
    order: 3,
    category: 'productivity',
    labels: ['prompts'],
    keywords: ['system-prompt', 'prompt', 'instructions', 'customization'],
    repository: { url: REPOSITORY, directory: 'plugins/system-prompt' },
    directory: 'plugins/system-prompt',
  },
}

const INDEX = {
  format: 1,
  title: {
    en: "Yujie's DSH Plugins",
    zh: 'Yujie 的 DSH 插件',
  },
  description: {
    en: 'A small, curated set of DeepSeek Harness plugins: session ports, CDP browser control, and a custom system prompt.',
    zh: '由 yujie 维护的一组 DeepSeek Harness 插件：会话端口、CDP 浏览器操控、自定义系统提示词。',
  },
  metadata: {
    categories: {
      'developer-tools': { title: { en: 'Developer tools', zh: '开发工具' } },
      automation: { title: { en: 'Automation', zh: '自动化' } },
      productivity: { title: { en: 'Productivity', zh: '效率工具' } },
    },
    labels: {
      sidebar: { title: { en: 'Sidebar', zh: '侧边栏' } },
      ports: { title: { en: 'Ports', zh: '端口' } },
      browser: { title: { en: 'Browser', zh: '浏览器' } },
      automation: { title: { en: 'Automation', zh: '自动化' } },
      prompts: { title: { en: 'Prompts', zh: '提示词' } },
    },
  },
  plugins: [],
}

/**
 * Read localized plugin meta from `locale/<lang>.json`.
 * @param directory - plugin directory.
 * @param language - locale id.
 * @returns the `meta` object, or undefined.
 */
function localeMeta(directory, language) {
  try {
    const document = JSON.parse(readFileSync(join(directory, 'locale', `${language}.json`), 'utf8'))
    const meta = document.meta
    if (meta !== undefined && typeof meta.title === 'string' && typeof meta.description === 'string') {
      return { title: meta.title, description: meta.description }
    }
  } catch {
    /* fall through to package.json */
  }
  return undefined
}

/**
 * Turn an SVG icon into an inline data URL the index can carry without any
 * extra request (and without depending on a CDN's content type).
 * @param directory - plugin directory.
 * @returns the data URL, or undefined when the file is missing or too large.
 */
function inlineIcon(directory) {
  const path = join(directory, 'icon.svg')
  try {
    const bytes = readFileSync(path)
    if (bytes.length > 32 * 1024) return undefined
    return `data:image/svg+xml;base64,${bytes.toString('base64')}`
  } catch {
    return undefined
  }
}

/**
 * Unix seconds of the last commit that touched a path, falling back to now.
 * @param absolutePath - the tracked path.
 * @returns integer Unix seconds.
 */
function lastCommitSeconds(absolutePath) {
  const relative = absolutePath.slice(ROOT.length + 1)
  try {
    const value = execFileSync('git', ['log', '-1', '--format=%ct', '--', relative], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (value !== '') return Number.parseInt(value, 10)
  } catch {
    /* fall back to the build time */
  }
  return Math.floor(Date.now() / 1000)
}

const pluginsDir = join(ROOT, 'plugins')
const plugins = []

for (const name of readdirSync(pluginsDir).sort()) {
  const directory = join(pluginsDir, name)
  if (!statSync(directory).isDirectory()) continue
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  } catch {
    console.warn(`skip plugins/${name}: no readable package.json`)
    continue
  }
  const meta = { ...(MARKET[manifest.name] ?? {}) }
  const en = localeMeta(directory, 'en')
  const zh = localeMeta(directory, 'zh')
  const packageDescription = typeof manifest.description === 'string' ? manifest.description : undefined
  const relative = `plugins/${name}`

  const entry = {
    name: manifest.name,
    title: {
      en: en?.title ?? manifest.name,
      ...(zh === undefined ? {} : { zh: zh.title }),
    },
    description: {
      en: en?.description ?? packageDescription ?? manifest.name,
      ...(zh === undefined ? {} : { zh: zh.description }),
    },
    author: 'yujieco',
    ...(meta.homepage === undefined ? {} : { homepage: meta.homepage }),
    repository: meta.repository ?? { url: REPOSITORY, directory: relative },
    metadata: {
      ...(meta.category === undefined ? {} : { category: meta.category }),
      keywords: meta.keywords ?? (Array.isArray(manifest.keywords) ? manifest.keywords : []),
      ...(meta.labels === undefined ? {} : { labels: meta.labels }),
    },
    versions: [
      {
        version: manifest.version,
        publishTimestamp: lastCommitSeconds(directory),
        source: {
          type: 'git',
          url: REPOSITORY,
          commit: COMMIT,
          path: meta.directory ?? relative,
        },
      },
    ],
  }

  const icon = inlineIcon(directory)
  if (icon !== undefined) entry.icon = icon

  plugins.push({ order: meta.order ?? 100, entry })
}

plugins.sort((left, right) => left.order - right.order || left.entry.name.localeCompare(right.entry.name))
INDEX.plugins = plugins.map((item) => item.entry)

writeFileSync(join(ROOT, 'index.json'), `${JSON.stringify(INDEX, null, 2)}\n`, 'utf8')

console.log(`index.json written: ${String(INDEX.plugins.length)} plugins at ${COMMIT}`)
for (const plugin of INDEX.plugins) {
  const version = plugin.versions[0]
  console.log(`  ${plugin.name}@${version.version}  path=${version.source.path}`)
}

/**
 * Run git in this repository and return stdout.
 * @param args - git arguments.
 * @returns stdout text.
 */
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}
