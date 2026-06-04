import { execSync } from 'child_process'
import { writeFileSync, existsSync, readFileSync } from 'fs'

// ── Terminal kleuren ────────────────────────────────────────────────────────
const c = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
}
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '')

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

// ── Git helpers ─────────────────────────────────────────────────────────────
function currentBranch() {
  return run('git branch --show-current') || 'HEAD'
}

function getDiff(branch, base = 'main') {
  return run(`git diff ${base}...${branch}`)
}

function getChangedFiles(branch, base = 'main') {
  return run(`git diff --name-only ${base}...${branch}`)
    .split('\n').filter(Boolean)
}

function getStats(branch, base = 'main') {
  const stat = run(`git diff --shortstat ${base}...${branch}`)
  const files   = stat.match(/(\d+) file/)?.[1] ?? '0'
  const added   = stat.match(/(\d+) insertion/)?.[1] ?? '0'
  const removed = stat.match(/(\d+) deletion/)?.[1] ?? '0'
  return { files, added, removed }
}

function getNewPackages(diff) {
  // Zoek nieuwe regels in package.json dependencies
  const pkgs = []
  let inDeps = false
  for (const line of diff.split('\n')) {
    if (line.includes('"dependencies"') || line.includes('"devDependencies"')) inDeps = true
    if (inDeps && line.startsWith('+') && !line.startsWith('+++')) {
      const match = line.match(/"([@\w][\w/.-]+)":\s*"/)
      if (match && match[1] !== 'dependencies' && match[1] !== 'devDependencies') {
        pkgs.push(match[1])
      }
    }
    if (inDeps && line.startsWith('+}')) inDeps = false
  }
  return [...new Set(pkgs)]
}

// ── Diff parser — geeft per bestand de toegevoegde regels met nummers ───────
function parseDiff(diffText) {
  const files = []
  let current = null
  let lineNum = 0

  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = { path: line.slice(6), added: [] }
      files.push(current)
      lineNum = 0
    } else if (line.startsWith('@@ ')) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/)
      if (m) lineNum = parseInt(m[1]) - 1
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      lineNum++
      current?.added.push({ n: lineNum, text: line.slice(1) })
    } else if (!line.startsWith('-')) {
      lineNum++
    }
  }

  return files
}

// ── Checks ───────────────────────────────────────────────────────────────────

/**
 * BLOCKER — lekken van private keys of wachtwoorden
 */
function checkSecrets(files) {
  const findings = []

  const patterns = [
    { re: /nsec1[a-z0-9]{20,}/,                    label: 'Nostr nsec privésleutel gevonden' },
    { re: /\bnsec\b\s*[=:]\s*["'][a-f0-9]{60,}/i,  label: 'Hex privésleutel in nsec variabele' },
    { re: /privateKey\s*[=:]\s*["'][a-f0-9]{60,}/i,label: 'Hex privésleutel in privateKey variabele' },
    { re: /password\s*[=:]\s*["'][^"']{8,}["']/i,  label: 'Hardcoded wachtwoord' },
    { re: /secret\s*[=:]\s*["'][a-zA-Z0-9+/=]{20,}["']/i, label: 'Hardcoded secret' },
    { re: /localStorage\.setItem\s*\(.*(?:nsec|privkey|privateKey)/i, label: 'Privésleutel in localStorage opgeslagen' },
    { re: /sk\s*=\s*["'][a-f0-9]{64}["']/,         label: 'Signing key hardcoded (64-char hex)' },
  ]

  for (const file of files) {
    if (file.path.includes('node_modules') || file.path.endsWith('.md')) continue
    for (const { n, text } of file.added) {
      for (const { re, label } of patterns) {
        if (re.test(text)) {
          findings.push({
            level: 'blocker',
            file: file.path,
            line: n,
            text: text.trim().slice(0, 80),
            msg: label,
            tip: 'Gebruik omgevingsvariabelen of NIP-07 — sla nooit sleutels op in code.',
          })
        }
      }
    }
  }

  return findings
}

/**
 * BLOCKER — .env bestand per ongeluk gecommit
 */
function checkEnvFile(changedFiles) {
  const findings = []
  for (const f of changedFiles) {
    if (/\.env($|\.)/.test(f) && !f.endsWith('.example') && !f.endsWith('.sample')) {
      findings.push({
        level: 'blocker',
        file: f,
        msg: '.env bestand staat in de commit',
        tip: 'Voeg .env toe aan .gitignore. Gebruik .env.example voor de template.',
      })
    }
  }
  return findings
}

/**
 * WAARSCHUWING — TODO/FIXME in toegevoegde code
 */
function checkTodos(files) {
  const findings = []
  for (const file of files) {
    if (file.path.includes('node_modules')) continue
    for (const { n, text } of file.added) {
      if (/\/\/\s*(TODO|FIXME|HACK|XXX)\b/i.test(text) || /<!--\s*(TODO|FIXME)/i.test(text)) {
        findings.push({
          level: 'warning',
          file: file.path,
          line: n,
          text: text.trim().slice(0, 80),
          msg: 'TODO/FIXME gevonden',
          tip: 'Is dit bewust of vergeten? Als het later is, maak een issue aan.',
        })
      }
    }
  }
  return findings
}

/**
 * WAARSCHUWING — console.log in productie (niet in tests)
 */
function checkConsoleLogs(files) {
  const findings = []
  for (const file of files) {
    const isTest = /\.(test|spec)\.(ts|tsx|js|mjs)$/.test(file.path)
    if (isTest || file.path.includes('node_modules')) continue
    const isScript = file.path.endsWith('.mjs') || file.path.includes('scripts/')
    if (isScript) continue // scripts mogen console.log gebruiken
    for (const { n, text } of file.added) {
      if (/console\.log\s*\(/.test(text) && !text.trim().startsWith('//')) {
        findings.push({
          level: 'warning',
          file: file.path,
          line: n,
          text: text.trim().slice(0, 80),
          msg: 'console.log in productie-code',
          tip: 'Verwijder of vervang door een logger. Gebruik // eslint-disable als het bewust is.',
        })
      }
    }
  }
  return findings
}

/**
 * WAARSCHUWING — nieuw React component zonder feature flag check
 */
function checkFeatureFlags(files) {
  const findings = []
  for (const file of files) {
    const isComponent = /\.(tsx|jsx)$/.test(file.path) && !file.path.includes('node_modules')
    if (!isComponent) continue

    const addedText = file.added.map(l => l.text).join('\n')
    const hasExport = /export\s+(default\s+)?function\s+[A-Z]|export\s+const\s+[A-Z]\w+\s*=/.test(addedText)
    const hasFlag   = /isEnabled\s*\(|useFeatureFlag\s*\(/.test(addedText)

    if (hasExport && !hasFlag) {
      findings.push({
        level: 'warning',
        file: file.path,
        msg: 'Nieuw component zonder feature flag check',
        tip: `Voeg toe: if (!isEnabled('${componentName(file.path)}')) return null`,
      })
    }
  }
  return findings
}

function componentName(filePath) {
  return filePath.split('/').pop()?.replace(/\.(tsx|jsx)$/, '').replace(/[A-Z]/g, m => m.toLowerCase()) ?? 'feature'
}

/**
 * WAARSCHUWING — nieuwe npm packages (flag voor Jurry)
 */
function checkNewPackages(diff, changedFiles) {
  const findings = []
  if (!changedFiles.some(f => f.endsWith('package.json'))) return findings

  const pkgs = getNewPackages(diff)
  for (const pkg of pkgs) {
    findings.push({
      level: 'warning',
      msg: `Nieuwe dependency: ${pkg}`,
      tip: `Heeft Jurry dit gereviewd? Run: node /home/deploy/scripts/jurry/index.js licenses`,
    })
  }
  return findings
}

/**
 * WAARSCHUWING — grote richtingswijziging detecteren
 */
function checkScale(stats, changedFiles) {
  const findings = []
  const deletions = parseInt(stats.removed)
  const additions = parseInt(stats.added)

  if (deletions > 200) {
    findings.push({
      level: 'warning',
      msg: `${deletions} regels verwijderd — grote richtingswijziging?`,
      tip: "Overweeg een pivot-tag: git tag -a pivot/$(date +%Y-%m) -m 'beschrijving'",
    })
  }

  const configFiles = changedFiles.filter(f =>
    f.includes('nginx') || f.includes('systemd') || f.includes('.env') || f === 'package.json'
  )
  if (configFiles.length > 0 && additions > 100) {
    findings.push({
      level: 'warning',
      msg: `Infrastructuurwijziging + veel code: ${configFiles.join(', ')}`,
      tip: 'Test op staging voor live — of tag dit als experiment.',
    })
  }
  return findings
}

/**
 * WAARSCHUWING — juridischadvies.md heeft onbeantwoorde vragen
 */
function checkJuridisch(changedFiles) {
  const findings = []
  for (const f of changedFiles) {
    if (f.endsWith('juridischadvies.md') && existsSync(f)) {
      const content = readFileSync(f, 'utf8')
      const unchecked = (content.match(/- \[ \]/g) || []).length
      if (unchecked > 0) {
        findings.push({
          level: 'warning',
          file: f,
          msg: `${unchecked} onbeantwoorde juridische vragen`,
          tip: `Run: node /home/deploy/scripts/jurry/index.js review`,
        })
      }
    }
  }
  return findings
}

// ── Transy's standaard realiteitsvragen ────────────────────────────────────────
const REALITY_QUESTIONS = [
  'Is elke feature in deze branch echt nodig, of is het feature creep?',
  'Wat kan er misgaan als dit live gaat — en wat kost het om dat te fixen?',
  'Heeft iemand anders dan de bouwer dit getest?',
  'Is dit de juiste oplossing of de snelste?',
  'Zijn er gebruikers die hier last van hebben als het niet werkt?',
  'Kan dit eenvoudiger? (drie soortgelijke regels > abstractie)',
]

// ── Formatter ────────────────────────────────────────────────────────────────
function formatFindings(findings, useColor = true) {
  const clr = useColor ? c : { red: s=>s, yellow: s=>s, green: s=>s, cyan: s=>s, bold: s=>s, dim: s=>s }

  const blockers  = findings.filter(f => f.level === 'blocker')
  const warnings  = findings.filter(f => f.level === 'warning')

  const lines = []

  if (blockers.length > 0) {
    lines.push(clr.bold(clr.red(`\n🔴 ${blockers.length} BLOCKER${blockers.length > 1 ? 'S' : ''} — lost op vóór merge naar main`)))
    for (const b of blockers) {
      const loc = b.file ? (b.line ? `${b.file}:${b.line}` : b.file) : ''
      lines.push(`\n  ${clr.red('✖')} ${clr.bold(b.msg)}`)
      if (loc) lines.push(`     ${clr.dim('↳')} ${clr.cyan(loc)}`)
      if (b.text) lines.push(`     ${clr.dim('↳')} ${clr.dim(b.text)}`)
      if (b.tip) lines.push(`     ${clr.dim('→')} ${b.tip}`)
    }
  } else {
    lines.push(clr.green('\n✅ Geen blockers gevonden'))
  }

  if (warnings.length > 0) {
    lines.push(clr.bold(clr.yellow(`\n🟡 ${warnings.length} WAARSCHUWING${warnings.length > 1 ? 'EN' : ''}`)))
    for (const w of warnings) {
      const loc = w.file ? (w.line ? `${w.file}:${w.line}` : w.file) : ''
      lines.push(`\n  ${clr.yellow('⚠')} ${w.msg}`)
      if (loc) lines.push(`     ${clr.dim('↳')} ${clr.cyan(loc)}`)
      if (w.text) lines.push(`     ${clr.dim('↳')} ${clr.dim(w.text)}`)
      if (w.tip) lines.push(`     ${clr.dim('→')} ${w.tip}`)
    }
  } else {
    lines.push(clr.green('✅ Geen waarschuwingen'))
  }

  return lines.join('\n')
}

function formatQuestions(useColor = true) {
  const clr = useColor ? c : { bold: s=>s, dim: s=>s, cyan: s=>s }
  const lines = [clr.bold('\n🤔 Ruby\'s realiteitsvragen — antwoord ze eerlijk')]
  for (const q of REALITY_QUESTIONS) {
    lines.push(`\n  ${clr.cyan('?')} ${q}`)
  }
  lines.push('')
  lines.push(clr.dim("  Als je op één van deze vragen twijfelt — praat er over met Perry."))
  lines.push(clr.dim("  Als je ze allemaal met 'ja, dat klopt' kunt beantwoorden — merge gerust."))
  return lines.join('\n')
}

function buildMarkdown(branch, base, stats, changedFiles, findings) {
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const blockers = findings.filter(f => f.level === 'blocker')
  const warnings = findings.filter(f => f.level === 'warning')

  const lines = [
    `# Transy Review — ${branch}`,
    `> Gegenereerd op ${date} | basis: ${base}`,
    `> Transy is de Chief Reality Officer — ze stelt de vragen die je later blij mee bent.`,
    '',
    `## Samenvatting`,
    '',
    `| | |`,
    `|--|--|`,
    `| Bestanden gewijzigd | ${stats.files} |`,
    `| Regels toegevoegd | +${stats.added} |`,
    `| Regels verwijderd | -${stats.removed} |`,
    `| Blockers | ${blockers.length} |`,
    `| Waarschuwingen | ${warnings.length} |`,
    '',
  ]

  if (blockers.length > 0) {
    lines.push(`## 🔴 Blockers — lost op vóór merge`, '')
    for (const b of blockers) {
      const loc = b.file ? (b.line ? `\`${b.file}:${b.line}\`` : `\`${b.file}\``) : ''
      lines.push(`### ${b.msg}`)
      if (loc) lines.push(`**Locatie:** ${loc}`)
      if (b.text) lines.push(`\`\`\`\n${b.text}\n\`\`\``)
      lines.push(`**Actie:** ${b.tip}`, '')
    }
  }

  if (warnings.length > 0) {
    lines.push(`## 🟡 Waarschuwingen`, '')
    for (const w of warnings) {
      const loc = w.file ? (w.line ? `\`${w.file}:${w.line}\`` : `\`${w.file}\``) : ''
      lines.push(`- **${w.msg}**${loc ? ` — ${loc}` : ''}`)
      lines.push(`  - ${w.tip}`)
    }
    lines.push('')
  }

  lines.push(
    `## 🤔 Transy's realiteitsvragen`,
    '',
    ...REALITY_QUESTIONS.map(q => `- [ ] ${q}`),
    '',
    `## Besluit`,
    '',
    blockers.length > 0
      ? `**⛔ NIET mergen** — los eerst de ${blockers.length} blocker(s) op.`
      : warnings.length > 0
        ? `**⚠️ Merge toegestaan** — behandel de waarschuwingen of documenteer waarom je ze negeert.`
        : `**✅ Merge akkoord** — geen blockers of waarschuwingen.`,
    '',
    `---`,
    `_Waarschuwingen negeren? Voeg toe in de code: \`<!-- RUBY: [waarschuwing] — genegeerd omdat: [reden] -->\`_`,
  )

  return lines.join('\n')
}

// ── Hoofdfunctie ─────────────────────────────────────────────────────────────
export async function runReview(args) {
  const branchIdx = args.indexOf('--branch')
  const branch    = branchIdx !== -1 ? args[branchIdx + 1] : currentBranch()
  const base      = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'main'
  const save      = args.includes('--save')

  if (branch === 'main' || branch === base) {
    console.log(c.yellow(`  Je zit al op '${branch}' — niets te reviewen ten opzichte van zichzelf.`))
    console.log(c.dim(`  Gebruik: node index.mjs review --branch <feature-branch>`))
    return
  }

  console.log(c.dim(`\n  Branch:  ${branch}`))
  console.log(c.dim(`  Basis:   ${base}`))

  const diff         = getDiff(branch, base)
  const changedFiles = getChangedFiles(branch, base)
  const stats        = getStats(branch, base)

  if (!diff) {
    console.log(c.yellow('\n  Geen verschil gevonden tussen branch en main.'))
    return
  }

  const files = parseDiff(diff)

  // Alle checks samenvoegen
  const findings = [
    ...checkSecrets(files),
    ...checkEnvFile(changedFiles),
    ...checkTodos(files),
    ...checkConsoleLogs(files),
    ...checkFeatureFlags(files),
    ...checkNewPackages(diff, changedFiles),
    ...checkScale(stats, changedFiles),
    ...checkJuridisch(changedFiles),
  ]

  // Output in terminal
  console.log(`\n${c.dim('Gewijzigde bestanden:')}`)
  for (const f of changedFiles.slice(0, 12)) {
    console.log(`  ${c.dim('·')} ${f}`)
  }
  if (changedFiles.length > 12) {
    console.log(c.dim(`  ... en ${changedFiles.length - 12} meer`))
  }

  console.log(formatFindings(findings, true))
  console.log(formatQuestions(true))

  // Samenvatting
  const blockers = findings.filter(f => f.level === 'blocker')
  const warnings = findings.filter(f => f.level === 'warning')

  console.log()
  console.log(`  Bestanden: ${stats.files}  |  +${stats.added} / -${stats.removed} regels`)
  console.log()

  if (save) {
    const md = buildMarkdown(branch, base, stats, changedFiles, findings)
    writeFileSync('RUBY-REVIEW.md', md)
    console.log(c.green(`  📄 RUBY-REVIEW.md opgeslagen`))
  }

  // Exit code: 1 als er blockers zijn (CI kan hierop reageren)
  if (blockers.length > 0) {
    process.exitCode = 1
  }
}
