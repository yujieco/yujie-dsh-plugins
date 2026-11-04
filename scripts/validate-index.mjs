#!/usr/bin/env node
/**
 * Validate index.json with the same parser DSH itself uses, and print the
 * exact install spec each entry resolves to. Run after `build:index`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MarketIndexError,
  marketInstallTarget,
  parseMarketIndex,
} from '@deepseek-ai/dsh-plugin-market-index'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_URL = 'https://raw.githubusercontent.com/yujieco/yujie-dsh-plugins/main/index.json'

const raw = JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8'))

try {
  const index = parseMarketIndex(raw, INDEX_URL)
  console.log(`valid format ${String(index.format)}: ${String(index.plugins.length)} plugins under "${index.title.en}"`)
  for (const plugin of index.plugins) {
    const version = plugin.versions[0]
    if (version === undefined) throw new Error(`${plugin.name} lists no version`)
    const install = marketInstallTarget(plugin.name, version)
    console.log(`  ${plugin.name}@${version.version}`)
    console.log(`    title:   ${plugin.title?.en ?? plugin.name}`)
    console.log(`    install: ${install.spec}`)
    if (install.registry !== undefined) console.log(`    registry: ${install.registry}`)
  }
} catch (error) {
  if (error instanceof MarketIndexError) {
    console.error(`invalid index at ${error.path}: ${error.reason}`)
  } else {
    console.error(error)
  }
  process.exitCode = 1
}
