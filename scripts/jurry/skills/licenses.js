import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const SAFE = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'CC0-1.0', 'Unlicense', '0BSD'];
const COPYLEFT = ['GPL-2.0', 'GPL-3.0', 'LGPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0', 'MPL-2.0'];
// Ethische source licenties: niet OSI-goedgekeurd, beperkingen op gebruik
const ETHICAL = ['Hippocratic'];

export async function checkLicenses({ appName, appsDir }) {
  const apps = appName
    ? [appName]
    : readdirSync(appsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !existsSync(join(appsDir, d.name, '.archived')))
        .map((d) => d.name);

  for (const app of apps) {
    const appDir = join(appsDir, app);
    const pkgPath = join(appDir, 'package.json');

    if (!existsSync(pkgPath)) {
      console.log(`\n  ⏭  ${app} — geen package.json, overgeslagen`);
      continue;
    }

    console.log(`\n📦 ${app}`);

    try {
      const raw = execSync('npm list --json --all --depth=1 2>/dev/null', {
        cwd: appDir,
        encoding: 'utf8',
      });
      const tree = JSON.parse(raw);
      const deps = Object.entries(tree.dependencies || {});

      if (deps.length === 0) {
        console.log(`  ℹ️  Geen geïnstalleerde dependencies gevonden. npm install gedraaid?`);
        continue;
      }

      const issues = [];
      const warns = [];

      for (const [name, info] of deps) {
        const lic = info.license || getLicenseFromNodeModules(appDir, name);
        if (!lic) {
          warns.push(`  ⚠️  ${name} — geen licentie gevonden`);
          continue;
        }
        const licClean = lic.replace(/\(|\)/g, '').split(' OR ')[0].trim();
        if (COPYLEFT.some((c) => licClean.includes(c))) {
          issues.push(`  🔴 ${name} (${lic}) — copyleft, broncode-eis kan van toepassing zijn`);
        } else if (ETHICAL.some((e) => licClean.includes(e))) {
          issues.push(`  🟠 ${name} (${lic}) — ethische source licentie, niet OSI-goedgekeurd, gebruik beperkt`);
        } else if (!SAFE.some((s) => licClean.includes(s))) {
          warns.push(`  🟡 ${name} (${lic}) — onbekende licentie, controleer handmatig`);
        }
      }

      if (issues.length === 0 && warns.length === 0) {
        console.log(`  ✓ Alle licenties zien er goed uit (${deps.length} directe deps)`);
      } else {
        issues.forEach((l) => console.log(l));
        warns.forEach((l) => console.log(l));
      }
    } catch (err) {
      console.log(`  ✗ Fout bij lezen dependencies: ${err.message}`);
    }
  }
}

function getLicenseFromNodeModules(appDir, pkgName) {
  try {
    const modDir = join(appDir, 'node_modules', pkgName);
    if (!existsSync(modDir)) return null;

    // Probeer package.json eerst
    const pkgPath = join(modDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.license) return pkg.license;
    }

    // Val terug op LICENSE bestand inhoud
    for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE']) {
      const lPath = join(modDir, candidate);
      if (existsSync(lPath)) {
        const content = readFileSync(lPath, 'utf8').slice(0, 300);
        if (/MIT License/i.test(content)) return 'MIT';
        if (/Apache License.*2\.0/i.test(content)) return 'Apache-2.0';
        if (/ISC License/i.test(content)) return 'ISC';
        if (/BSD 2-Clause/i.test(content)) return 'BSD-2-Clause';
        if (/BSD 3-Clause/i.test(content)) return 'BSD-3-Clause';
        if (/GNU General Public License.*v3/i.test(content)) return 'GPL-3.0';
        if (/GNU General Public License.*v2/i.test(content)) return 'GPL-2.0';
        if (/Hippocratic/i.test(content)) return 'Hippocratic';
        return '(zie LICENSE bestand)';
      }
    }

    return null;
  } catch {
    return null;
  }
}
