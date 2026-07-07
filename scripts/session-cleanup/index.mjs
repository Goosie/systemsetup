#!/usr/bin/env node
/**
 * session-cleanup — reclaim swap by closing abandoned tmux sessions
 *
 * Root cause of the recurring "swap bijna vol" alarm: over a long uptime,
 * detached tmux sessions (mostly idle Claude Code sessions) pile up and their
 * pages migrate to swap. This weekly job closes the ones that are clearly
 * abandoned so the swap doesn't creep toward full.
 *
 * SAFE heuristic — a session is killed ONLY when BOTH hold:
 *   1. it is NOT attached (session_attached == 0) — nobody is looking at it
 *   2. no activity for > STALE_DAYS days (session_activity)
 * An attached session, or one touched within the window, is never touched.
 * Killing a session ends its Claude process, but that context is recoverable
 * with `claude --resume <id>` (the transcript persists on disk).
 *
 * systemd services (blocky, goose-runner, healthy, lnbits, …) are NOT tmux
 * sessions, so this never touches infrastructure.
 *
 * Runs via goose-runner (User=deploy → same tmux socket /tmp/tmux-1000/default).
 *
 * Usage:
 *   node index.mjs run        # real: close stale sessions   (Blocky sends this)
 *   node index.mjs dry-run    # report only, close nothing
 */

import { execSync, execFileSync } from 'child_process';

const DRY_RUN    = process.argv.includes('dry-run') || process.argv.includes('--dry-run');
const STALE_DAYS = 7;                                 // tune here: detached + idle longer than this = abandoned
const STALE_MS   = STALE_DAYS * 24 * 60 * 60 * 1000;
const TMUX       = '/usr/bin/tmux';

function swapUsedMB() {
  try {
    return execSync("free -m | awk '/^Swap:/{print $3\"/\"$2}'", { encoding: 'utf8' }).trim() || '?';
  } catch { return '?'; }
}

function listSessions() {
  // Throws when no tmux server is running — treat as "nothing to clean".
  let raw;
  try {
    raw = execFileSync(TMUX, ['list-sessions', '-F', '#{session_name}|#{session_attached}|#{session_activity}'],
      { encoding: 'utf8', timeout: 15_000 }).trim();
  } catch {
    return null; // no server
  }
  if (!raw) return [];
  return raw.split('\n').map(l => {
    const [name, attached, activity] = l.split('|');
    return { name, attached: attached === '1', activity: parseInt(activity, 10) * 1000 };
  });
}

function killSession(name) {
  execFileSync(TMUX, ['kill-session', '-t', name], { timeout: 15_000 });
}

// ── Main ──────────────────────────────────────────────────────────────────────
const now        = Date.now();
const swapBefore = swapUsedMB();
const sessions   = listSessions();

if (sessions === null) {
  console.log('✔ No tmux server running — nothing to clean.');
  console.log(`Swap: ${swapBefore}MB in use.`);
  process.exit(0);
}

const report = [];
const killed = [];

for (const s of sessions) {
  const idleMs   = now - s.activity;
  const idleDays = (idleMs / 86_400_000).toFixed(1);
  const stale    = !s.attached && idleMs > STALE_MS;

  if (!stale) {
    const why = s.attached ? 'attached' : `idle ${idleDays}d < ${STALE_DAYS}d`;
    report.push(`✔ keep    ${s.name} (${why})`);
    continue;
  }

  if (DRY_RUN) {
    report.push(`✘ would close ${s.name} (detached, idle ${idleDays}d)`);
  } else {
    try {
      killSession(s.name);
      killed.push(s.name);
      report.push(`✘ closed  ${s.name} (detached, idle ${idleDays}d)`);
    } catch (e) {
      report.push(`⚠ failed  ${s.name}: ${String(e.message).slice(0, 60)}`);
    }
  }
}

const swapAfter = swapUsedMB();

console.log(`🧹 session-cleanup${DRY_RUN ? ' (dry-run)' : ''} — closes detached tmux sessions idle > ${STALE_DAYS}d`);
console.log(report.join('\n') || '(no sessions)');
console.log('');
console.log(`Sessions: ${sessions.length} total, ${killed.length} closed`);
console.log(DRY_RUN
  ? `Swap: ${swapBefore}MB in use (unchanged, dry-run).`
  : `Swap: ${swapBefore}MB → ${swapAfter}MB in use.`);

process.exit(0);
