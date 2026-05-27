import { execSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { check } from './check.js';
import { analyzeLogs } from './logs.js';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export async function report({ appsDir }) {
  console.log('\n🛡️  Secury — volledig security rapport');
  console.log('═'.repeat(50));
  console.log(`Datum: ${new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}`);

  await check();
  await analyzeLogs({ hours: 24 });

  // npm audit per app
  console.log('\n\n📦 npm audit — kwetsbaarheden per app');
  console.log('─'.repeat(50));

  const apps = readdirSync(appsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !existsSync(join(appsDir, d.name, '.archived')))
    .filter(d => existsSync(join(appsDir, d.name, 'package.json')))
    .map(d => d.name);

  let cleanCount = 0;
  for (const app of apps) {
    const out = run(`cd ${join(appsDir, app)} && npm audit --json 2>/dev/null`);
    if (!out) { console.log(`  ⚪ ${app}: audit niet uitvoerbaar`); continue; }

    try {
      const parsed = JSON.parse(out);
      const vulns = parsed.metadata?.vulnerabilities ?? {};
      const high = (vulns.high ?? 0) + (vulns.critical ?? 0);
      const mod  = vulns.moderate ?? 0;
      const low  = vulns.low ?? 0;

      if (high > 0) {
        console.log(`  🔴 ${app}: ${vulns.critical ?? 0} critical, ${vulns.high ?? 0} high, ${mod} moderate, ${low} low`);
      } else if (mod > 0) {
        console.log(`  🟡 ${app}: ${mod} moderate, ${low} low`);
      } else if (low > 0) {
        console.log(`  🟢 ${app}: ${low} low`);
        cleanCount++;
      } else {
        console.log(`  🟢 ${app}: schoon`);
        cleanCount++;
      }
    } catch {
      console.log(`  ⚪ ${app}: kan audit-output niet lezen`);
    }
  }

  console.log(`\n  ${cleanCount}/${apps.length} apps zonder high/critical kwetsbaarheden`);

  // Summary
  console.log('\n\n📋 Aanbevelingen');
  console.log('─'.repeat(50));
  console.log('  • Run "gans secury check" voor actuele fail2ban status');
  console.log('  • Run "gans secury logs" voor verkeersanalyse');
  console.log('  • Voer npm audit fix uit in apps met high/critical findings');
  console.log('  • Controleer onverwachte poorten en sluit ze af indien nodig');
}
