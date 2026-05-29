#!/usr/bin/env node
/**
 * Kill switch voor features — zet een feature aan of uit zonder code te schrijven.
 *
 * Gebruik:
 *   node scripts/toggle-feature.mjs donationButton false   ← uitzetten
 *   node scripts/toggle-feature.mjs donationButton true    ← aanzetten
 *   node scripts/toggle-feature.mjs --list                 ← overzicht
 */

import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { resolve } from 'path'

const args = process.argv.slice(2)
const featuresPath = resolve('src/config/features.ts')

if (args[0] === '--list' || args.length === 0) {
  const content = readFileSync(featuresPath, 'utf8')
  console.log('\nHuidige feature flags:\n')
  for (const match of content.matchAll(/(\w+):\s*(true|false)/g)) {
    const icon = match[2] === 'true' ? '✅' : '❌'
    console.log(`  ${icon}  ${match[1]}: ${match[2]}`)
  }
  console.log()
  process.exit(0)
}

const [feature, rawValue] = args
if (!feature || rawValue === undefined) {
  console.error('Gebruik: node scripts/toggle-feature.mjs <feature> <true|false>')
  process.exit(1)
}

if (rawValue !== 'true' && rawValue !== 'false') {
  console.error(`Waarde moet 'true' of 'false' zijn, niet: ${rawValue}`)
  process.exit(1)
}

const value = rawValue === 'true'
let content

try {
  content = readFileSync(featuresPath, 'utf8')
} catch {
  console.error(`features.ts niet gevonden op: ${featuresPath}`)
  process.exit(1)
}

const regex = new RegExp(`(${feature}:\\s*)(true|false)`)
if (!regex.test(content)) {
  console.error(`Feature '${feature}' niet gevonden in features.ts`)
  console.error('Beschikbare features:')
  for (const match of content.matchAll(/(\w+):\s*(true|false)/g)) {
    console.error(`  - ${match[1]}`)
  }
  process.exit(1)
}

const currentValue = content.match(regex)?.[2]
if (currentValue === String(value)) {
  console.log(`ℹ️  ${feature} is al ${value} — niks gewijzigd`)
  process.exit(0)
}

const updated = content.replace(regex, `$1${value}`)
writeFileSync(featuresPath, updated)
console.log(`${value ? '✅' : '❌'} ${feature} → ${value}`)

console.log('🏗  Rebuilden...')
try {
  execSync('npm run build', { stdio: 'inherit' })
  console.log(`\n✅ Klaar. ${feature} is nu ${value ? 'AAN' : 'UIT'}.`)
} catch {
  console.error('\n❌ Build mislukt — features.ts teruggezet naar origineel')
  writeFileSync(featuresPath, content)
  process.exit(1)
}
