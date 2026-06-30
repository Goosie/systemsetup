#!/usr/bin/env node
/**
 * Gitty — git goosie for the Goosie Labs V-Formation
 *
 * Manages both remotes:
 *   • GitHub (Goosie org) via the `gh` CLI — the commands below
 *   • the self-hosted Gitea mirror (Tailscale 100.111.14.11) via `mirror.mjs`
 *
 * Commands:
 *   create-repo <name>   Create a private GitHub repo under Goosie/<name>
 *   push <name>          Set remote + push app to GitHub
 *   status               Show GitHub status for all apps
 *   sync-all             Create + push any app that is missing on GitHub
 *   mirror <subcmd>      Run a Gitea-mirror command (create-repo|push|status|sync-all)
 */

import { execSync, execFileSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const APPS_DIR  = '/var/www/goosielabs/apps';
const GH_ORG    = 'Goosie';

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function runOk(cmd) {
  try { run(cmd); return true; } catch { return false; }
}

function apps() {
  return readdirSync(APPS_DIR).filter(name => {
    if (name.startsWith('.')) return false;
    if (existsSync(resolve(APPS_DIR, name, '.archived'))) return false;
    return existsSync(resolve(APPS_DIR, name, '.git'));
  });
}

function githubRepos() {
  try {
    const out = run(`gh repo list ${GH_ORG} --limit 200 --json name --jq '.[].name'`);
    return new Set(out.split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

function getRemote(appDir) {
  try {
    return run('git remote get-url origin', { cwd: appDir });
  } catch {
    return null;
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

function createRepo(name) {
  console.log(`\n🐙 Gitty: creating GitHub repo Goosie/${name}...`);
  try {
    run(`gh repo create ${GH_ORG}/${name} --private --source=. --remote=origin --push`, {
      cwd: resolve(APPS_DIR, name),
    });
    console.log(`  ✅ Created and pushed: https://github.com/${GH_ORG}/${name}`);
  } catch (e) {
    // Repo may already exist
    const msg = e.message ?? '';
    if (msg.includes('already exists') || msg.includes('Name already exists')) {
      console.log(`  ℹ️  Repo already exists — setting remote and pushing`);
      push(name);
    } else {
      throw e;
    }
  }
}

function push(name) {
  const appDir = resolve(APPS_DIR, name);
  if (!existsSync(appDir)) throw new Error(`App not found: ${appDir}`);

  console.log(`\n🐙 Gitty: pushing ${name} to GitHub...`);

  // Ensure remote points to GitHub
  const remoteUrl = `https://github.com/${GH_ORG}/${name}.git`;
  const current = getRemote(appDir);
  if (current !== remoteUrl) {
    if (current) {
      run(`git remote set-url origin ${remoteUrl}`, { cwd: appDir });
    } else {
      run(`git remote add origin ${remoteUrl}`, { cwd: appDir });
    }
    console.log(`  🔗 Remote set to ${remoteUrl}`);
  }

  run('git push -u origin main --quiet', { cwd: appDir });
  console.log(`  ✅ Pushed: https://github.com/${GH_ORG}/${name}`);
}

function status() {
  console.log(`\n🐙 Gitty — GitHub Status (${GH_ORG} org)\n`);
  const onGitHub  = githubRepos();
  const localApps = apps();

  let ok = 0, missing = 0;

  for (const name of localApps.sort()) {
    const exists = onGitHub.has(name);
    if (exists) {
      const appDir = resolve(APPS_DIR, name);
      const remote = getRemote(appDir);
      const synced = remote?.includes('github.com');
      console.log(`  ✅  ${name.padEnd(24)} https://github.com/${GH_ORG}/${name}${!synced ? ' (remote mismatch)' : ''}`);
      ok++;
    } else {
      console.log(`  ❌  ${name.padEnd(24)} no GitHub repo`);
      missing++;
    }
  }

  console.log(`\n  ${ok} on GitHub, ${missing} missing`);
  if (missing > 0) console.log(`  Run: gans gitty sync-all`);
}

async function syncAll() {
  console.log(`\n🐙 Gitty: sync-all — ensuring all apps are on GitHub...\n`);
  const onGitHub  = githubRepos();
  const localApps = apps();
  let created = 0, skipped = 0, failed = 0;

  for (const name of localApps) {
    if (onGitHub.has(name)) {
      console.log(`  ⏭  ${name} — already on GitHub`);
      skipped++;
      continue;
    }
    try {
      createRepo(name);
      created++;
    } catch (e) {
      console.log(`  ❌  ${name} — ${e.message.split('\n')[0]}`);
      failed++;
    }
  }

  console.log(`\n✅ Done — ${created} created, ${skipped} already existed, ${failed} failed`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

console.log('🐙 Gitty — Git Goosie (GitHub + Gitea mirror)');
console.log('────────────────────────');

switch (cmd) {
  case 'create-repo': {
    const name = args[0];
    if (!name) { console.error('Usage: gitty create-repo <name>'); process.exit(1); }
    createRepo(name);
    break;
  }
  case 'push': {
    const name = args[0];
    if (!name) { console.error('Usage: gitty push <name>'); process.exit(1); }
    push(name);
    break;
  }
  case 'status':
    status();
    break;
  case 'sync-all':
    await syncAll();
    break;
  case 'mirror': {
    // Gitea self-hosted mirror (Tailscale 100.111.14.11) — delegates to mirror.mjs
    try {
      execSync(`node /home/deploy/scripts/gitty/mirror.mjs ${args.join(' ')}`, { stdio: 'inherit' });
    } catch { process.exit(1); }
    break;
  }
  default:
    console.log('Commands:');
    console.log('  create-repo <name>   Create a private GitHub repo under Goosie/<name>');
    console.log('  push <name>          Set remote + push app to GitHub');
    console.log('  status               Show GitHub status for all apps');
    console.log('  sync-all             Create + push any app missing on GitHub');
    console.log('  mirror <subcmd>      Gitea mirror: create-repo | push | status | sync-all');
}
