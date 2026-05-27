import { execSync } from 'child_process';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export async function check() {
  console.log('\n🔒 Fail2ban — jail status');
  console.log('─'.repeat(50));

  const jails = ['sshd', 'nginx-xmlrpc', 'nginx-botsearch', 'nginx-bad-request'];
  for (const jail of jails) {
    const out = run(`sudo fail2ban-client status ${jail}`);
    if (!out) { console.log(`  ${jail}: niet bereikbaar`); continue; }

    const failed  = out.match(/Currently failed:\s+(\d+)/)?.[1] ?? '?';
    const banned  = out.match(/Currently banned:\s+(\d+)/)?.[1] ?? '?';
    const total   = out.match(/Total banned:\s+(\d+)/)?.[1] ?? '?';
    const ips     = out.match(/Banned IP list:\s+(.*)/)?.[1]?.trim() || '—';

    const icon = Number(banned) > 0 ? '🔴' : '🟢';
    console.log(`\n  ${icon} ${jail}`);
    console.log(`     Actief gebanned: ${banned}  |  Totaal ooit: ${total}  |  Nu gefaald: ${failed}`);
    if (ips !== '—') console.log(`     IPs: ${ips}`);
  }

  console.log('\n\n🔌 Luisterende poorten');
  console.log('─'.repeat(50));
  const ports = run("ss -tlnp | awk 'NR>1 {print $4, $6}' | column -t");
  const EXPECTED = ['22', '80', '443', '3001', '3002', '3338', '5000', '7778', '3306', '53'];
  if (ports) {
    for (const line of ports.split('\n')) {
      const port = line.match(/:(\d+)\s/)?.[1];
      const flag = port && !EXPECTED.includes(port) ? ' ⚠️  onverwacht' : '';
      console.log(`  ${line}${flag}`);
    }
  }

  console.log('\n\n🔑 Recente SSH-logins (succesvol)');
  console.log('─'.repeat(50));
  const logins = run("last -n 8 -F | head -8");
  if (logins) console.log(logins.split('\n').map(l => `  ${l}`).join('\n'));

  console.log('\n\n🚫 Recente fail2ban bans');
  console.log('─'.repeat(50));
  const bans = run("sudo grep 'Ban ' /var/log/fail2ban.log | tail -10");
  if (bans) console.log(bans.split('\n').map(l => `  ${l}`).join('\n'));
  else console.log('  Geen recente bans gevonden.');
}
