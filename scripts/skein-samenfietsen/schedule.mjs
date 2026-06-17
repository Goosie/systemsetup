#!/usr/bin/env node
// 3x/day random scheduler.
//
// Long-running process. Picks 3 random times within the configured window
// (default 08:00–22:00 Europe/Amsterdam), runs poll.mjs at each, then resets
// for the next day at midnight. The 'random' makes us look less bot-like to
// SamenFietsen's traffic monitoring.

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLL_SCRIPT = join(__dirname, 'poll.mjs');

const TZ = process.env.TZ || 'Europe/Amsterdam';
const RUNS_PER_DAY = Number(process.env.RUNS_PER_DAY || 3);
const WINDOW_START = Number(process.env.WINDOW_START_HOUR || 8);  // 08:00
const WINDOW_END   = Number(process.env.WINDOW_END_HOUR   || 22); // 22:00
const MIN_GAP_HOURS = 2;

function localMinutesSinceMidnight() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date()).reduce((a, p) => (a[p.type] = p.value, a), {});
  return Number(parts.hour) * 60 + Number(parts.minute);
}

// Pick N random minute-offsets within [start*60, end*60), at least
// MIN_GAP_HOURS*60 minutes apart.
function pickDailySlots() {
  const windowStart = WINDOW_START * 60;
  const windowEnd = WINDOW_END * 60;
  const gap = MIN_GAP_HOURS * 60;
  const out = [];
  for (let attempt = 0; attempt < 50 && out.length < RUNS_PER_DAY; attempt++) {
    const candidate = windowStart + Math.floor(Math.random() * (windowEnd - windowStart));
    if (out.every(t => Math.abs(t - candidate) >= gap)) out.push(candidate);
  }
  return out.sort((a, b) => a - b);
}

function fmt(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function runPoll() {
  const ts = new Date().toISOString();
  console.log(`[schedule] ${ts} — kicking off poll`);
  const child = spawn(process.execPath, [POLL_SCRIPT], { stdio: 'inherit' });
  child.on('exit', code => console.log(`[schedule] poll exited ${code}`));
}

let pending = [];

function scheduleNext() {
  // Drop slots that have already passed today.
  const now = localMinutesSinceMidnight();
  pending = pending.filter(t => t > now);

  if (pending.length === 0) {
    // Plan tomorrow at next midnight.
    const minutesUntilMidnight = (24 * 60) - now;
    console.log(`[schedule] no more runs today — replanning at midnight (in ${minutesUntilMidnight} min)`);
    setTimeout(planToday, (minutesUntilMidnight + 1) * 60 * 1000);
    return;
  }

  const next = pending[0];
  const delayMin = next - now;
  console.log(`[schedule] next poll at ${fmt(next)} (in ${delayMin} min). remaining today: ${pending.map(fmt).join(', ')}`);
  setTimeout(() => {
    runPoll();
    pending.shift();
    scheduleNext();
  }, delayMin * 60 * 1000);
}

function planToday() {
  pending = pickDailySlots();
  console.log(`[schedule] today's plan: ${pending.map(fmt).join(', ')}`);
  scheduleNext();
}

console.log(`[schedule] starting (TZ=${TZ} runs/day=${RUNS_PER_DAY} window=${WINDOW_START}-${WINDOW_END})`);
planToday();
