import { execSync } from 'child_process';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export async function analyzeLogs({ hours = 24 } = {}) {
  const logfile = '/var/log/nginx/access.log';

  console.log(`\n📊 Nginx log analyse — laatste ${hours} uur`);
  console.log('─'.repeat(50));

  // Top 10 IPs
  const topIps = run(
    `awk '{print $1}' ${logfile} | sort | uniq -c | sort -rn | head -10`
  );
  console.log('\n🌐 Top 10 IPs (totaal requests)');
  if (topIps) {
    for (const line of topIps.split('\n')) {
      const [, count, ip] = line.trim().match(/(\d+)\s+(.+)/) ?? [];
      if (!count) continue;
      const flag = Number(count) > 500 ? ' 🔴 hoog volume' : Number(count) > 100 ? ' 🟡' : '';
      console.log(`  ${count.padStart(6)}  ${ip}${flag}`);
    }
  }

  // Top 403/404 paths
  console.log('\n\n🚧 Top paden met 403 of 404');
  const badPaths = run(
    `awk '$9 ~ /^(403|404)$/ {print $7}' ${logfile} | sort | uniq -c | sort -rn | head -10`
  );
  if (badPaths) {
    for (const line of badPaths.split('\n')) {
      const [, count, path] = line.trim().match(/(\d+)\s+(.+)/) ?? [];
      if (!count) continue;
      console.log(`  ${count.padStart(6)}  ${path}`);
    }
  } else {
    console.log('  Geen 403/404 gevonden.');
  }

  // xmlrpc hits
  const xmlrpc = run(`grep -c 'xmlrpc.php' ${logfile} 2>/dev/null`) ?? '0';
  console.log(`\n\n🤖 xmlrpc.php pogingen in totale log: ${xmlrpc}`);

  // Suspicious user agents
  console.log('\n\n🕵️  Verdachte user agents (scanners/bots)');
  const bots = run(
    `awk -F'"' '{print $6}' ${logfile} | grep -iE '(sqlmap|nikto|masscan|zgrab|nmap|python-requests|go-http|curl/|nuclei|scanner)' | sort | uniq -c | sort -rn | head -10`
  );
  if (bots) {
    for (const line of bots.split('\n')) {
      console.log(`  ${line.trim()}`);
    }
  } else {
    console.log('  Geen bekende scanners gevonden.');
  }

  // Rapid fire: IPs with many requests in short window (approximation via last 1000 lines)
  console.log('\n\n⚡ IPs met >50 requests in laatste 1000 log-regels');
  const rapid = run(
    `tail -1000 ${logfile} | awk '{print $1}' | sort | uniq -c | sort -rn | awk '$1 > 50'`
  );
  if (rapid) {
    for (const line of rapid.split('\n')) {
      const [, count, ip] = line.trim().match(/(\d+)\s+(.+)/) ?? [];
      console.log(`  ${count.padStart(6)}  ${ip} 🔴`);
    }
  } else {
    console.log('  Geen.');
  }
}
