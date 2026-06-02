#!/bin/bash
# ============================================
# backup.sh — Goosie Labs volledige backup
# Draait automatisch dagelijks om 3:00 AM
# ============================================

WEBROOT="/var/www/goosielabs"
BACKUP_DIR="/home/deploy/backups"
ZAPHUNT_DB="/var/www/goosielabs/apps/zaphunt/data/zaphunt.db"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
STATUS_FILE="/var/www/goosielabs/apps/zaphunt/BACKUP_STATUS.json"
ERRORS=()

echo ""
echo "🔒 Goosielabs backup — $TIMESTAMP"
echo "=================================="

# --- Layer 1: Git snapshot ---
echo "📦 Git snapshot..."
cd $WEBROOT
git add -A
git commit -m "backup-$TIMESTAMP" --allow-empty
if [ $? -eq 0 ]; then
  echo "   ✅ Git done"
else
  echo "   ⚠️  Git snapshot had issues"
  ERRORS+=("git-snapshot")
fi

# --- Layer 2: ZapHunt SQLite ---
echo "🗃️  ZapHunt SQLite backup..."
if [ -f "$ZAPHUNT_DB" ]; then
  mkdir -p $BACKUP_DIR/sqlite
  cp $ZAPHUNT_DB $BACKUP_DIR/sqlite/zaphunt-$TIMESTAMP.db
  if [ $? -eq 0 ]; then
    SQLITE_SIZE=$(du -h $BACKUP_DIR/sqlite/zaphunt-$TIMESTAMP.db | cut -f1)
    echo "   ✅ ZapHunt DB backed up ($SQLITE_SIZE)"
  else
    echo "   ❌ ZapHunt SQLite backup failed"
    ERRORS+=("zaphunt-sqlite")
  fi
  # Keep last 10 only
  ls -t $BACKUP_DIR/sqlite/*.db 2>/dev/null | tail -n +11 | xargs rm -f
else
  echo "   ℹ️  ZapHunt DB not yet created (app not used yet)"
fi

# --- Layer 3: Status JSON — push to GitHub ---
echo "📊 Status to GitHub..."

ERROR_STR=$(printf '"%s",' "${ERRORS[@]}")
ERROR_STR="[${ERROR_STR%,}]"
STATUS="ok"
[ ${#ERRORS[@]} -gt 0 ] && STATUS="partial"

SQLITE_SIZE_JSON="null"
[ -f "$BACKUP_DIR/sqlite/zaphunt-$TIMESTAMP.db" ] && SQLITE_SIZE_JSON="\"$SQLITE_SIZE\""

cat > $STATUS_FILE << EOF
{
  "last_backup": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "timestamp": "$TIMESTAMP",
  "status": "$STATUS",
  "errors": $ERROR_STR,
  "layers": {
    "git_snapshot": $(printf '%s\n' "${ERRORS[@]}" | grep -qx "git-snapshot" && echo "false" || echo "true"),
    "zaphunt_sqlite": $(printf '%s\n' "${ERRORS[@]}" | grep -qx "zaphunt-sqlite" && echo "false" || echo "true")
  },
  "sizes": {
    "zaphunt_db": $SQLITE_SIZE_JSON
  },
  "server": "goosielabs.com"
}
EOF

cd /var/www/goosielabs/apps/zaphunt
git add BACKUP_STATUS.json
git commit -m "backy: backup status $TIMESTAMP [status=$STATUS]"
git push origin main
if [ $? -eq 0 ]; then
  echo "   ✅ Status pushed to GitHub"
else
  echo "   ⚠️  GitHub push failed (saved locally)"
fi

echo ""
if [ ${#ERRORS[@]} -eq 0 ]; then
  echo "✅ All backups done! Rollback tag: backup-$TIMESTAMP"
else
  echo "⚠️  Backup done with ${#ERRORS[@]} error(s): ${ERRORS[*]}"
fi
echo ""
