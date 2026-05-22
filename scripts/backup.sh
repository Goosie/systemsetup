#!/bin/bash
# ============================================
# backup.sh — Goosie Labs volledige backup
# Draait automatisch dagelijks om 3:00 AM
# ============================================

WEBROOT="/var/www/goosielabs"
BACKUP_DIR="/home/deploy/backups"
DB_NAME="wp_identity_demo"
ZAPHUNT_DB="/var/www/goosielabs/apps/zaphunt/data/zaphunt.db"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
STATUS_FILE="/var/www/goosielabs/apps/zaphunt/BACKUP_STATUS.json"
ERRORS=()

echo ""
echo "🔒 Goosielabs backup — $TIMESTAMP"
echo "=================================="

# --- Layer 1: Git snapshot WordPress ---
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

# --- Layer 2: rsync uploads ---
echo "🖼️  Syncing uploads..."
rsync -a --delete $WEBROOT/wp-content/uploads/ $BACKUP_DIR/uploads/
if [ $? -eq 0 ]; then
  echo "   ✅ Uploads synced"
else
  echo "   ❌ Uploads sync failed"
  ERRORS+=("uploads-rsync")
fi

# --- Layer 3: MariaDB dump ---
echo "🗄️  Dumping database..."
mkdir -p $BACKUP_DIR/db
mysqldump --defaults-file=/home/deploy/.my-backup.cnf $DB_NAME > $BACKUP_DIR/db/db-$TIMESTAMP.sql
if [ $? -eq 0 ]; then
  DB_SIZE=$(du -h $BACKUP_DIR/db/db-$TIMESTAMP.sql | cut -f1)
  echo "   ✅ Database dumped ($DB_SIZE)"
else
  echo "   ❌ Database dump failed"
  ERRORS+=("mariadb-dump")
fi
# Bewaar alleen de laatste 10 dumps
ls -t $BACKUP_DIR/db/*.sql 2>/dev/null | tail -n +11 | xargs rm -f

# --- Layer 4: ZapHunt SQLite ---
echo "🗃️  ZapHunt SQLite backup..."
if [ -f "$ZAPHUNT_DB" ]; then
  mkdir -p $BACKUP_DIR/sqlite
  cp $ZAPHUNT_DB $BACKUP_DIR/sqlite/zaphunt-$TIMESTAMP.db
  if [ $? -eq 0 ]; then
    SQLITE_SIZE=$(du -h $BACKUP_DIR/sqlite/zaphunt-$TIMESTAMP.db | cut -f1)
    echo "   ✅ ZapHunt DB gebackupt ($SQLITE_SIZE)"
  else
    echo "   ❌ ZapHunt SQLite backup mislukt"
    ERRORS+=("zaphunt-sqlite")
  fi
  # Bewaar alleen de laatste 10
  ls -t $BACKUP_DIR/sqlite/*.db 2>/dev/null | tail -n +11 | xargs rm -f
else
  echo "   ℹ️  ZapHunt DB nog niet aangemaakt (app nog niet gebruikt)"
fi

# --- Layer 5: Status JSON schrijven en pushen naar GitHub ---
echo "📊 Status naar GitHub..."

ERROR_STR=$(printf '"%s",' "${ERRORS[@]}")
ERROR_STR="[${ERROR_STR%,}]"
STATUS="ok"
[ ${#ERRORS[@]} -gt 0 ] && STATUS="partial"

SQLITE_SIZE_JSON="null"
[ -f "$BACKUP_DIR/sqlite/zaphunt-$TIMESTAMP.db" ] && SQLITE_SIZE_JSON="\"$SQLITE_SIZE\""

DB_SIZE_JSON="null"
[ -f "$BACKUP_DIR/db/db-$TIMESTAMP.sql" ] && DB_SIZE_JSON="\"$DB_SIZE\""

cat > $STATUS_FILE << EOF
{
  "last_backup": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "timestamp": "$TIMESTAMP",
  "status": "$STATUS",
  "errors": $ERROR_STR,
  "layers": {
    "git_snapshot": $(printf '%s\n' "${ERRORS[@]}" | grep -qx "git-snapshot" && echo "false" || echo "true"),
    "uploads_rsync": $(printf '%s\n' "${ERRORS[@]}" | grep -qx "uploads-rsync" && echo "false" || echo "true"),
    "mariadb_dump": $(printf '%s\n' "${ERRORS[@]}" | grep -qx "mariadb-dump" && echo "false" || echo "true"),
    "zaphunt_sqlite": $(printf '%s\n' "${ERRORS[@]}" | grep -qx "zaphunt-sqlite" && echo "false" || echo "true")
  },
  "sizes": {
    "wordpress_db": $DB_SIZE_JSON,
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
  echo "   ✅ Status gepusht naar GitHub"
else
  echo "   ⚠️  GitHub push mislukt (lokaal wel opgeslagen)"
fi

echo ""
if [ ${#ERRORS[@]} -eq 0 ]; then
  echo "✅ Alle backups geslaagd! Rollback tag: backup-$TIMESTAMP"
else
  echo "⚠️  Backup klaar met ${#ERRORS[@]} fout(en): ${ERRORS[*]}"
fi
echo ""
