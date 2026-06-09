#!/usr/bin/env node
/**
 * Cssy — CSS Design System Goose
 *
 * Commands:
 *   status       — template.css stats + which apps use it
 *   themes       — list all named themes
 *   audit        — find CSS variables used in code but undeclared in template.css
 *   sync <name>  — create/update apps/<name>/public/theme.css
 *   sync-all     — sync theme.css for every active app
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const TEMPLATE   = '/home/deploy/templates/template.css';
const APPS_DIR   = '/var/www/goosielabs/apps';
const WEBROOT    = '/var/www/goosielabs';

const command = process.argv[2] || 'status';
const arg     = process.argv[3];

// ── helpers ──────────────────────────────────────────────────────────────────

function readTemplate() {
  return readFileSync(TEMPLATE, 'utf8');
}

function getThemes() {
  const css = readTemplate();
  const matches = [...css.matchAll(/\[data-theme="([^"]+)"\]/g)];
  return ['light (default)', ...matches.map(m => m[1])];
}

function getDeclaredVars() {
  const css = readTemplate();
  return new Set([...css.matchAll(/--([a-zA-Z0-9_-]+)\s*:/g)].map(m => '--' + m[1]));
}

function getActiveApps() {
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !existsSync(join(APPS_DIR, e.name, '.archived')))
    .map(e => e.name);
}

function findUsedVarsIn(dir) {
  try {
    const result = execSync(
      `grep -roh "var(--[a-zA-Z0-9_-]*)" ${dir} ` +
      `--include="*.tsx" --include="*.ts" --include="*.jsx" --include="*.css" ` +
      `--exclude-dir=node_modules --exclude-dir=dist 2>/dev/null`,
      { encoding: 'utf8' }
    );
    return new Set(
      result.trim().split('\n')
        .map(s => s.match(/var\((--[^)]+)\)/)?.[1])
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function themeTemplate(appName) {
  const title = appName.charAt(0).toUpperCase() + appName.slice(1);
  return `/* theme.css — ${title}
 * Inherits all design tokens from template.css.
 * Only add overrides that are specific to this app below.
 * Maintained by @Cssy
 */
@import '/templates/template.css';

/* App-specific overrides — uncomment and edit as needed */
/* :root { */
/*   --color-brand: #yourcolor; */
/* } */
`;
}

// ── commands ──────────────────────────────────────────────────────────────────

switch (command) {

  case 'status': {
    const lines = readTemplate().split('\n').length;
    const themes = getThemes();
    const apps = getActiveApps();
    const withTheme = apps.filter(a => existsSync(join(APPS_DIR, a, 'public', 'theme.css')));
    console.log(`🎨 Cssy — CSS Design System`);
    console.log(`   template.css:  ${lines} lines`);
    console.log(`   Themes:        ${themes.join(', ')}`);
    console.log(`   Active apps:   ${apps.length}`);
    console.log(`   With theme.css: ${withTheme.length} / ${apps.length}`);
    const missing = apps.filter(a => !withTheme.includes(a));
    if (missing.length) console.log(`   Missing:       ${missing.join(', ')}`);
    break;
  }

  case 'themes': {
    const themes = getThemes();
    console.log(`🎨 Themes in template.css:`);
    themes.forEach(t => console.log(`   ${t}`));
    break;
  }

  case 'audit': {
    console.log(`🔍 Cssy — Variable Audit\n`);
    const declared = getDeclaredVars();
    const apps = getActiveApps();

    const undeclared = new Map(); // varName → Set of apps using it

    // scan main webroot (excluding apps/)
    const webVars = findUsedVarsIn(WEBROOT + '/src');
    for (const v of webVars) {
      if (!declared.has(v)) {
        if (!undeclared.has(v)) undeclared.set(v, new Set());
        undeclared.get(v).add('main-site');
      }
    }

    // scan each app
    for (const app of apps) {
      const appSrc = join(APPS_DIR, app, 'src');
      if (!existsSync(appSrc)) continue;
      const vars = findUsedVarsIn(appSrc);
      for (const v of vars) {
        if (!declared.has(v)) {
          if (!undeclared.has(v)) undeclared.set(v, new Set());
          undeclared.get(v).add(app);
        }
      }
    }

    if (undeclared.size === 0) {
      console.log(`   ✅ All CSS variables are declared in template.css`);
    } else {
      console.log(`   ⚠️  ${undeclared.size} undeclared variable(s) found:\n`);
      for (const [varName, usedBy] of [...undeclared].sort()) {
        console.log(`   ${varName}`);
        console.log(`      used in: ${[...usedBy].join(', ')}`);
      }
      console.log(`\n   Run with --fix to add these to template.css`);

      if (process.argv.includes('--fix')) {
        const additions = [...undeclared.keys()].map(v =>
          `  ${v}: /* TODO: set value */;`
        ).join('\n');
        const block = `\n/* discovered — undeclared variables found in the wild */\n:root {\n${additions}\n}\n`;
        const css = readTemplate();
        writeFileSync(TEMPLATE, css + block);
        console.log(`\n   ✅ Added ${undeclared.size} variable(s) to template.css`);
      }
    }
    break;
  }

  case 'sync': {
    if (!arg) { console.error('Usage: sync <appname>'); process.exit(1); }
    const dest = join(APPS_DIR, arg, 'public', 'theme.css');
    if (!existsSync(join(APPS_DIR, arg))) {
      console.error(`App "${arg}" not found in ${APPS_DIR}`); process.exit(1);
    }
    writeFileSync(dest, themeTemplate(arg));
    console.log(`🎨 theme.css written → ${dest}`);
    console.log(`   Add to index.html:`);
    console.log(`   <link rel="stylesheet" href="/templates/template.css" />`);
    console.log(`   <link rel="stylesheet" href="theme.css" />`);
    break;
  }

  case 'sync-all': {
    const apps = getActiveApps();
    let created = 0, skipped = 0;
    for (const app of apps) {
      const dest = join(APPS_DIR, app, 'public', 'theme.css');
      if (existsSync(dest)) { skipped++; continue; }
      if (!existsSync(join(APPS_DIR, app, 'public'))) { skipped++; continue; }
      writeFileSync(dest, themeTemplate(app));
      console.log(`   ✓ ${app}`);
      created++;
    }
    console.log(`\n🎨 sync-all done: ${created} created, ${skipped} skipped (already exist or no public/)`);
    break;
  }

  default:
    console.log(`Usage: node index.mjs [status|themes|audit [--fix]|sync <name>|sync-all]`);
}
