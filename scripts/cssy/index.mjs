#!/usr/bin/env node
/**
 * Cssy — CSS Design System Goose
 *
 * Commands:
 *   status        — template.css stats + which apps use it
 *   themes        — list all named themes
 *   audit         — find CSS variables used in code but undeclared in template.css
 *   wire <name>   — inject theme-loader + theme-selector into apps/<name>/index.html
 *   wire-all      — wire every active app that hasn't been wired yet
 *   sync <name>   — create/update apps/<name>/public/theme.css (app-specific overrides)
 *   sync-all      — sync theme.css for every active app
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
 * Inherits all design tokens from template.css via theme-loader.js.
 * Only add overrides that are specific to this app below.
 * Maintained by @Cssy
 */

/* App-specific overrides — uncomment and edit as needed */
/* :root { */
/*   --color-brand: #yourcolor; */
/* } */
`;
}

// Checks if an index.html already has the theme-loader injected
function isWired(indexHtml) {
  return indexHtml.includes('theme-loader.js');
}

// Injects theme-loader into <head> and theme-selector before </body>
function wireIndexHtml(html) {
  // Insert theme-loader as last item in <head>
  html = html.replace(
    /(<\/head>)/i,
    '        <!-- Theme system — Cssy -->\n        <script src="/theme-loader.js"></script>\n    $1'
  );
  // Insert theme-selector before </body>
  html = html.replace(
    /(<\/body>)/i,
    '        <!-- Theme selector — Perry-only, fixed bottom-right -->\n        <script src="/theme-selector.js" defer></script>\n    $1'
  );
  return html;
}

// ── commands ──────────────────────────────────────────────────────────────────

switch (command) {

  case 'status': {
    const lines = readTemplate().split('\n').length;
    const themes = getThemes();
    const apps = getActiveApps();
    const wired = apps.filter(a => {
      const idx = join(APPS_DIR, a, 'index.html');
      if (!existsSync(idx)) return false;
      return isWired(readFileSync(idx, 'utf8'));
    });
    console.log(`🎨 Cssy — CSS Design System`);
    console.log(`   template.css:  ${lines} lines`);
    console.log(`   Themes:        ${themes.join(', ')}`);
    console.log(`   Active apps:   ${apps.length}`);
    console.log(`   Theme-wired:   ${wired.length} / ${apps.length}`);
    const unwired = apps.filter(a => !wired.includes(a));
    if (unwired.length) console.log(`   Not wired:     ${unwired.join(', ')}`);
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
    const undeclared = new Map();

    const webVars = findUsedVarsIn(WEBROOT + '/src');
    for (const v of webVars) {
      if (!declared.has(v)) {
        if (!undeclared.has(v)) undeclared.set(v, new Set());
        undeclared.get(v).add('main-site');
      }
    }

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
        writeFileSync(TEMPLATE, readTemplate() + block);
        console.log(`\n   ✅ Added ${undeclared.size} variable(s) to template.css`);
      }
    }
    break;
  }

  case 'wire': {
    if (!arg) { console.error('Usage: wire <appname>'); process.exit(1); }
    const indexPath = join(APPS_DIR, arg, 'index.html');
    if (!existsSync(indexPath)) {
      console.error(`No index.html found at ${indexPath}`); process.exit(1);
    }
    const html = readFileSync(indexPath, 'utf8');
    if (isWired(html)) {
      console.log(`🎨 ${arg} — already wired`);
    } else {
      writeFileSync(indexPath, wireIndexHtml(html));
      console.log(`🎨 ${arg} — wired ✓`);
      console.log(`   Rebuild the app to apply: npm run build (in apps/${arg}/)`);
    }
    break;
  }

  case 'wire-all': {
    const apps = getActiveApps();
    let wired = 0, skipped = 0, noHtml = 0;
    for (const app of apps) {
      const indexPath = join(APPS_DIR, app, 'index.html');
      if (!existsSync(indexPath)) { noHtml++; continue; }
      const html = readFileSync(indexPath, 'utf8');
      if (isWired(html)) { skipped++; continue; }
      writeFileSync(indexPath, wireIndexHtml(html));
      console.log(`   ✓ ${app}`);
      wired++;
    }
    console.log(`\n🎨 wire-all done: ${wired} wired, ${skipped} already wired, ${noHtml} no index.html`);
    if (wired > 0) console.log(`   Rebuild each wired app to apply changes.`);
    break;
  }

  case 'sync': {
    if (!arg) { console.error('Usage: sync <appname>'); process.exit(1); }
    const publicDir = join(APPS_DIR, arg, 'public');
    if (!existsSync(join(APPS_DIR, arg))) {
      console.error(`App "${arg}" not found`); process.exit(1);
    }
    if (existsSync(publicDir)) {
      writeFileSync(join(publicDir, 'theme.css'), themeTemplate(arg));
      console.log(`🎨 theme.css written → ${publicDir}/theme.css`);
    } else {
      console.log(`   No public/ dir in ${arg} — skipped theme.css`);
    }
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
    console.log(`\n🎨 sync-all done: ${created} created, ${skipped} skipped`);
    break;
  }

  default:
    console.log(`Usage: node index.mjs [status|themes|audit [--fix]|wire <name>|wire-all|sync <name>|sync-all]`);
}
