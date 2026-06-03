function goosie() {
    echo ""
    echo "🦆 Goosielabs CLI"
    echo "=================================="
    echo "  newapp <naam>      Nieuwe app aanmaken"
    echo "  openapp <naam>     Bestaande app openen"
    echo "  deleteapp <naam>   App volledig verwijderen (nginx, tmux, GitHub, tiles)"
    echo "  listapps           Alle apps tonen"
    echo "  startmytmux        tmux sessie per actieve app"
    echo "  goosie <name> ...  Run a goose with log (jurry/haitje/tessa/secury/humany/gitty/gitea)"
    echo "  goosie-log <name>  View last log of a goose"
    echo ""
    echo "🛡️  Secury — security goose"
    echo "----------------------------------"
    echo "  goosie secury check    Fail2ban status, open poorten, recente bans"
    echo "  goosie secury logs     Nginx analyse: top IPs, scanners, 403/404"
    echo "  goosie secury report   Volledig rapport + npm audit per app"
    echo "  goosie-backup      Backup draaien"
    echo "  reload             ~/.bashrc opnieuw sourcen (na wijzigingen in ~/.bashrc.d/)"
    echo ""
    echo "🪟 tmux — sessies"
    echo "----------------------------------"
    echo "  tmux new -s <naam>          Nieuwe sessie aanmaken"
    echo "  tmux attach -t <naam>       Terugkoppelen aan sessie"
    echo "  tmux ls                     Alle sessies tonen"
    echo "  echo \$TMUX                  Check of je al in tmux zit"
    echo "  tmux kill-session -t <naam> Sessie stoppen"
    echo ""
    echo "🎹 tmux — sneltoetsen (Ctrl+B loslaten, dan...)"
    echo "----------------------------------"
    echo "  D          Loskoppelen (sessie blijft draaien)"
    echo "  S          Sessie picker (wisselen tussen sessies)"
    echo "  C          Nieuw venster"
    echo "  ,          Venster hernoemen"
    echo "  pijltje    Wisselen tussen panelen"
    echo "  [          Scroll mode (Q = stoppen)"
    echo "  Z          Zoom in/uit op huidig paneel"
    echo "  %          Splits paneel verticaal"
    echo "  \"          Splits paneel horizontaal"
    echo ""
    echo "🤖 Claude Code in tmux"
    echo "----------------------------------"
    echo "  claude --resume <session-id>  Sessie hervatten na loskoppelen"
    echo "  (session-id staat in output als Claude Code afsluit)"
    echo "  exit2 / save session          Sessie opslaan → schrijft CLAUDE_RESUME.md"
    echo ""
    echo "🐳 Docker — RGB test container"
    echo "----------------------------------"
    echo "  docker start rgb-test            Container herstart"
    echo "  docker exec -it rgb-test bash    Terug in container"
    echo "  docker rm -f rgb-test            Container verwijderen"
    echo ""
    echo "🐙 GitHub — pushen"
    echo "----------------------------------"
    echo "  git push                         Huidige repo pushen"
    echo "  git push -u origin main          Eerste keer pushen (upstream zetten)"
    echo "  bash ~/sync-auth.sh              Auth sync + build + push alle apps"
    echo "  bash ~/sync-auth.sh --dry-run    Eerst kijken wat er verandert"
    echo "  bash ~/sync-auth.sh <app>        Één specifieke app synchen"
    echo "  for a in /var/www/goosielabs/apps/*/; do git -C \"\$a\" push; done"
    echo "" 
    echo " GITEA pull en pushen"
    echo " Zowel op de server als op de desktop:  pullgitea en pushgitea"
    echo ""
}

function listapps() {
    echo "🦆 Apps:"
    for app in /var/www/goosielabs/apps/*/; do
        name=$(basename "$app")
        if [ ! -f "$app/.archived" ]; then
            echo "  $name"
        fi
    done
}

function deleteapp() {
    local APPNAME="$1"

    if [ -z "$APPNAME" ]; then
        echo "Gebruik: deleteapp <naam>"
        return 1
    fi

    local APPDIR="/var/www/goosielabs/apps/$APPNAME"

    if [ ! -d "$APPDIR" ]; then
        echo "❌ App '$APPNAME' niet gevonden in $APPDIR"
        return 1
    fi

    echo ""
    echo "⚠️  Dit wordt verwijderd:"
    echo "   📁 $APPDIR"
    echo "   🌐 Nginx location block(s) voor /apps/$APPNAME/"
    tmux has-session -t "$APPNAME" 2>/dev/null && echo "   🪟 tmux sessie '$APPNAME'"
    gh repo view "Goosie/$APPNAME" --json name -q .name 2>/dev/null && echo "   🐙 GitHub repo Goosie/$APPNAME"
    echo ""
    echo -n "Typ de naam van de app om te bevestigen: "
    read confirm

    if [ "$confirm" != "$APPNAME" ]; then
        echo "Geannuleerd."
        return 1
    fi

    # Kill tmux session
    tmux kill-session -t "$APPNAME" 2>/dev/null && echo "🪟 tmux sessie gestopt"

    # Remove nginx location block(s) for this app
    sudo python3 -c "
import sys
app = sys.argv[1]
with open('/etc/nginx/sites-enabled/goosielabs.com') as f:
    lines = f.readlines()
result = []
skip = False
for line in lines:
    if 'location /apps/' + app + '/' in line:
        skip = True
        if result and result[-1].strip() == '':
            result.pop()
        continue
    if skip:
        if line.strip() == '}':
            skip = False
        continue
    result.append(line)
with open('/etc/nginx/sites-enabled/goosielabs.com', 'w') as f:
    f.writelines(result)
" "$APPNAME" && echo "🌐 Nginx block verwijderd"
    if sudo nginx -t 2>/dev/null; then
        pid=$(ps aux | grep 'nginx: master' | grep -v grep | awk '{print $2}' | head -1)
        if [ -n "$pid" ]; then
            sudo kill -HUP "$pid" && echo "🌐 Nginx herladen"
        else
            echo "⚠️  Nginx master PID niet gevonden"
        fi
    fi

    # Remove app directory
    rm -rf "$APPDIR" && echo "📁 Map verwijderd"

    # Delete GitHub repo
    gh repo delete "Goosie/$APPNAME" --yes 2>/dev/null && echo "🐙 GitHub repo verwijderd"


    # Delete Gitea repo
     source ~/.goosie.env
     curl -s -X DELETE "http://$GITEA_HOST:$GITEA_PORT/api/v1/repos/$GITEA_USER/$APPNAME" \-H "Authorization: token $GITEA_TOKEN" && echo "🦆 Gitea repo verwijderd"

    # Update landing page
    bash /home/deploy/update-tiles.sh 2>/dev/null && echo "🏠 Landing page bijgewerkt"

    # Verwijder uit CLAUDE.md
    sed -i "/| $APPNAME /d" /home/deploy/.claude/CLAUDE.md && echo "📝 CLAUDE.md bijgewerkt"

    # Verwijder claude-config symlinks
    rm -f /home/deploy/claude-config/apps/$APPNAME 2>/dev/null && echo "🔗 claude-config symlinks verwijderd"



    echo ""
    echo "✅ App '$APPNAME' volledig verwijderd."
}
