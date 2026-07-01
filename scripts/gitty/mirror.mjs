#!/usr/bin/env node
/**
 * Gitea — Gitea mirror goose for the Goosie Labs V-Formation
 *
 * Manages repos on the local Gitea instance (Tailscale: 100.111.14.11).
 * Uses Gitea REST API for repo management and SSH git push for code.
 *
 * Commands:
 *   create-repo <name>   Create a repo on Gitea
 *   push <name>          Set gitea remote + push app
 *   status               Show Gitea status for all apps
 *   sync-all             Create + push any app missing on Gitea
 */

import { execSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const APPS_DIR    = '/var/www/goosielabs/apps';
const GITEA_HOST  = process.env.GITEA_HOST  ?? '100.111.14.11';
const GITEA_PORT  = process.env.GITEA_PORT  ?? '8085';
const GITEA_USER  = process.env.GITEA_USER  ?? 'perry';
const GITEA_TOKEN = process.env.GITEA_TOKEN ?? (() => {
  // Load from .goosie.env if available
  try {
    const env = execSync('bash -c \'source ~/.goosie.env && echo $GITEA_TOKEN\'', { encoding: 'utf8' }).trim();
    return env;
  } catch { return ''; }
})();

const GITEA_API   = `http://${GITEA_HOST}:${GITEA_PORT}/api/v1`;
const GITEA_SSH   = `git@gitea:${GITEA_USER}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function apps() {
  return readdirSync(APPS_DIR).filter(name => {
    if (name.startsWith('.')) return false;
    if (existsSync(resolve(APPS_DIR, name, '.archived'))) return false;
    return existsSync(resolve(APPS_DIR, name, '.git'));
  });
}

async function apiGet(path) {
  const res = await fetch(`${GITEA_API}${path}`, {
    headers: { Authorization: `token ${GITEA_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Gitea API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${GITEA_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `token ${GITEA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok && res.status !== 409) throw new Error(`Gitea API ${res.status}: ${text}`);
  return { status: res.status, body: text };
}

async function giteaRepos() {
  try {
    const repos = await apiGet(`/repos/search?limit=200`);
    return new Set(repos.data.map(r => r.name));
  } catch {
    return new Set();
  }
}

function getGiteaRemote(appDir) {
  try {
    return run('git remote get-url gitea', { cwd: appDir });
  } catch {
    return null;
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function createRepo(name) {
  console.log(`\n🏮 Gitea: creating repo ${GITEA_USER}/${name}...`);
  const result = await apiPost(`/user/repos`, {
    name,
    private: true,
    auto_init: false,
    description: `Mirror of Goosie Labs app: ${name}`,
  });

  if (result.status === 409) {
    console.log(`  ℹ️  Repo already exists on Gitea`);
  } else {
    console.log(`  ✅ Created: http://${GITEA_HOST}:${GITEA_PORT}/${GITEA_USER}/${name}`);
  }
}

function push(name) {
  const appDir = resolve(APPS_DIR, name);
  if (!existsSync(appDir)) throw new Error(`App not found: ${appDir}`);

  console.log(`\n🏮 Gitea: pushing ${name}...`);

  const remoteUrl = `${GITEA_SSH}/${name}.git`;
  const current   = getGiteaRemote(appDir);

  if (current !== remoteUrl) {
    if (current) {
      run(`git remote set-url gitea ${remoteUrl}`, { cwd: appDir });
    } else {
      run(`git remote add gitea ${remoteUrl}`, { cwd: appDir });
    }
    console.log(`  🔗 Gitea remote set`);
  }

  // Detect the repo's actual current branch (master, main, …) and push that
  // to the same-named branch on Gitea — hardcoding "main" breaks any repo
  // whose default branch differs (e.g. iris → master).
  const branch = run('git symbolic-ref --short HEAD', { cwd: appDir });
  run(`git push gitea ${branch} --quiet`, { cwd: appDir });
  console.log(`  ✅ Pushed ${branch}: http://${GITEA_HOST}:${GITEA_PORT}/${GITEA_USER}/${name}`);
}

async function status() {
  console.log(`\n🏮 Gitea — Mirror Status (${GITEA_HOST}:${GITEA_PORT})\n`);
  const onGitea   = await giteaRepos();
  const localApps = apps();
  let ok = 0, missing = 0;

  for (const name of localApps.sort()) {
    const exists = onGitea.has(name);
    if (exists) {
      const appDir = resolve(APPS_DIR, name);
      const remote = getGiteaRemote(appDir);
      const synced = remote?.includes('gitea');
      console.log(`  ✅  ${name.padEnd(24)} ${GITEA_HOST}:${GITEA_PORT}/${GITEA_USER}/${name}${!synced ? ' (remote not set)' : ''}`);
      ok++;
    } else {
      console.log(`  ❌  ${name.padEnd(24)} no Gitea repo`);
      missing++;
    }
  }

  console.log(`\n  ${ok} on Gitea, ${missing} missing`);
  if (missing > 0) console.log(`  Run: gans gitea sync-all`);
}

async function syncAll() {
  console.log(`\n🏮 Gitea: sync-all — ensuring all apps are mirrored...\n`);
  const onGitea   = await giteaRepos();
  const localApps = apps();
  let created = 0, skipped = 0, failed = 0;

  for (const name of localApps) {
    if (onGitea.has(name)) {
      // Ensure remote is set and push latest
      try {
        push(name);
        console.log(`  ✅ ${name} — pushed`);
        skipped++;
      } catch (e) {
        console.log(`  ⚠️  ${name} — push failed: ${e.message.split('\n')[0]}`);
        failed++;
      }
      continue;
    }
    try {
      await createRepo(name);
      push(name);
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

// Load env from .goosie.env if not already set
try {
  const env = execSync('bash -c \'source ~/.goosie.env && env | grep GITEA\'', { encoding: 'utf8' });
  for (const line of env.split('\n')) {
    const [k, v] = line.split('=');
    if (k && v && !process.env[k]) process.env[k] = v;
  }
} catch { /* ignore */ }

console.log('🏮 Gitea — Mirror Goose');
console.log('────────────────────────');

switch (cmd) {
  case 'create-repo': {
    const name = args[0];
    if (!name) { console.error('Usage: gitea create-repo <name>'); process.exit(1); }
    await createRepo(name);
    break;
  }
  case 'push': {
    const name = args[0];
    if (!name) { console.error('Usage: gitea push <name>'); process.exit(1); }
    push(name);
    break;
  }
  case 'status':
    await status();
    break;
  case 'sync-all':
    await syncAll();
    break;
  default:
    console.log('Commands:');
    console.log('  create-repo <name>   Create a repo on Gitea');
    console.log('  push <name>          Set gitea remote + push app');
    console.log('  status               Show Gitea mirror status for all apps');
    console.log('  sync-all             Create + push any app missing on Gitea');
}
