#!/bin/bash
# checkhealthy — Goosie Labs server health check
# Outputs: colored report with ✔ / ⚠ / ✘ indicators
#
# LIVE = THIS FILE. /usr/local/bin/checkhealthy is a symlink to this repo file,
# so editing here IS live — no deploy/copy step, no drift. Do NOT replace the
# symlink with a copy (that reintroduces the "committed but not live" gap).

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✔${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
fail() { echo -e "  ${RED}✘${RESET} $1"; }
section() { echo -e "\n${BOLD}${CYAN}── $1 ──${RESET}"; }

ISSUES=0
WARNINGS=0

check_service() {
  local name="$1" label="$2"
  if systemctl is-active --quiet "$name" 2>/dev/null; then
    ok "$label actief"
  else
    fail "$label GESTOPT — start: sudo systemctl start $name"
    ((ISSUES++))
  fi
}

# ── Systeem ────────────────────────────────────────────────────────────────────
section "Systeem"

# Load average — use the 15-minute figure (field 3) so transient build spikes
# don't trip the alarm; threshold is per-core (load ÷ cores):
#   verhoogd at load/core ≥ 1.0   ·   hoog at load/core ≥ 2.0
LOAD=$(cat /proc/loadavg | awk '{print $3}')
CORES=$(nproc)
LOAD_INT=$(echo "$LOAD * 100" | bc | cut -d. -f1)
WARN_AT=$((CORES * 100))   # load/core ≥ 1.0
FAIL_AT=$((CORES * 200))   # load/core ≥ 2.0
if [ "$LOAD_INT" -gt "$FAIL_AT" ]; then
  fail "Load hoog (15m): $LOAD over $CORES cores"
  ((ISSUES++))
elif [ "$LOAD_INT" -gt "$WARN_AT" ]; then
  warn "Load verhoogd (15m): $LOAD over $CORES cores"
  ((WARNINGS++))
else
  ok "Load: $LOAD (15m, $CORES cores)"
fi

# RAM
FREE_MB=$(free -m | awk '/^Mem:/{print $7}')
TOTAL_MB=$(free -m | awk '/^Mem:/{print $2}')
FREE_PCT=$((FREE_MB * 100 / TOTAL_MB))
if [ "$FREE_MB" -lt 100 ]; then
  fail "RAM kritiek: ${FREE_MB}MB vrij van ${TOTAL_MB}MB — sluit ongebruikte claude-sessies"
  ((ISSUES++))
elif [ "$FREE_MB" -lt 200 ]; then
  warn "RAM laag: ${FREE_MB}MB vrij van ${TOTAL_MB}MB"
  ((WARNINGS++))
else
  ok "RAM: ${FREE_MB}MB vrij van ${TOTAL_MB}MB"
fi

# Swap — high swap only hurts under real memory pressure. "Cold" swap (idle pages
# parked by the kernel, no thrashing) is normal, so FAIL only when swap is high
# AND free RAM is nearly gone; otherwise it's just an informational warning.
SWAP_USED=$(free -m | awk '/^Swap:/{print $3}')
SWAP_TOTAL=$(free -m | awk '/^Swap:/{print $2}')
MEM_AVAIL=$(free -m | awk '/^Mem:/{print $7}')
if [ "$SWAP_TOTAL" -eq 0 ]; then
  warn "Geen swap actief — risico bij OOM"
  ((WARNINGS++))
elif [ "$SWAP_USED" -gt $((SWAP_TOTAL * 80 / 100)) ] && [ "$MEM_AVAIL" -lt 400 ]; then
  fail "Swap vol + RAM krap: ${SWAP_USED}/${SWAP_TOTAL}MB swap, nog ${MEM_AVAIL}MB RAM vrij"
  ((ISSUES++))
elif [ "$SWAP_USED" -gt $((SWAP_TOTAL * 80 / 100)) ]; then
  warn "Swap hoog: ${SWAP_USED}/${SWAP_TOTAL}MB — maar ${MEM_AVAIL}MB RAM vrij (koud, geen thrashing)"
  ((WARNINGS++))
else
  ok "Swap: ${SWAP_USED}/${SWAP_TOTAL}MB (${MEM_AVAIL}MB RAM vrij)"
fi

# Disk
DISK_PCT=$(df / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$DISK_PCT" -gt 90 ]; then
  fail "Disk kritiek: ${DISK_PCT}% vol — opruimen nodig"
  ((ISSUES++))
elif [ "$DISK_PCT" -gt 75 ]; then
  warn "Disk: ${DISK_PCT}% vol"
  ((WARNINGS++))
else
  ok "Disk: ${DISK_PCT}% vol"
fi

# ── Services ───────────────────────────────────────────────────────────────────
section "Services"

check_service "nginx"        "Nginx"
check_service "strfry"       "Nostr relay (strfry)"
check_service "lnbits"       "LNbits"
check_service "nutshell"     "Cashu mint (nutshell)"
check_service "blocky"       "Blocky (block scheduler)"
check_service "backy"        "Backy (backup)"

# ── Nginx config ───────────────────────────────────────────────────────────────
section "Nginx"
if sudo nginx -t 2>/dev/null; then
  ok "Nginx config geldig"
else
  NGINX_ERR=$(sudo nginx -t 2>&1)
  fail "Nginx config fout: $NGINX_ERR"
  ((ISSUES++))
fi

# ── Relay bereikbaar ──────────────────────────────────────────────────────────
section "Connectiviteit"
if curl -sf --max-time 3 "http://127.0.0.1:7778" -o /dev/null 2>/dev/null; then
  ok "Nostr relay lokaal bereikbaar"
else
  warn "Nostr relay lokaal niet bereikbaar op poort 7778"
  ((WARNINGS++))
fi

if curl -sf --max-time 3 "http://127.0.0.1:5000/api/v1/health" -o /dev/null 2>/dev/null; then
  ok "LNbits API bereikbaar"
else
  warn "LNbits API niet bereikbaar op poort 5000"
  ((WARNINGS++))
fi

if curl -sf --max-time 3 "http://127.0.0.1:3338/v1/info" -o /dev/null 2>/dev/null; then
  ok "Cashu mint bereikbaar"
else
  warn "Cashu mint niet bereikbaar op poort 3338"
  ((WARNINGS++))
fi

# ── Samenvatting ──────────────────────────────────────────────────────────────
section "Samenvatting"
echo -e "  Problemen:    ${RED}${ISSUES}${RESET}"
echo -e "  Waarschuwingen: ${YELLOW}${WARNINGS}${RESET}"
echo -e "  Check tijd:   $(date '+%Y-%m-%d %H:%M:%S')"

if [ "$ISSUES" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "\n${GREEN}${BOLD}  Alles groen — server gezond 🪿${RESET}\n"
  exit 0
elif [ "$ISSUES" -eq 0 ]; then
  echo -e "\n${YELLOW}${BOLD}  Kleine aandachtspunten — geen kritieke problemen${RESET}\n"
  exit 0
else
  echo -e "\n${RED}${BOLD}  Kritieke problemen gevonden — actie nodig${RESET}\n"
  exit 1
fi
