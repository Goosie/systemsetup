server {
    listen 443 ssl;
    server_name goosielabs.com www.goosielabs.com;

    root /var/www/goosielabs;
    index index.html;

    ssl_certificate /etc/letsencrypt/live/www.goosielabs.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.goosielabs.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Inject Nostr login pill into all HTML responses (self-suppresses in React apps)
    sub_filter '</body>' '<script src="/nostr-pill.js" defer></script></body>';
    sub_filter_once on;
    sub_filter_types *;

    location /koppenberg {
        root /var/www/goosielabs/koppenberg;
        try_files $uri $uri/ /koppenberg/index.html;
    }

    location /api/admission/ {
        proxy_pass http://127.0.0.1:3004/api/admission/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Headers "Content-Type" always;
    }

    location = /.well-known/nostr.json {
        alias /var/www/goosielabs/.well-known/nostr.json;
        add_header Content-Type "application/json";
        add_header Access-Control-Allow-Origin "*";
        add_header Cache-Control "no-cache";
    }

    location = /relay-config.json {
        alias /var/www/goosielabs/relay-config.json;
        add_header Content-Type "application/json";
        add_header Access-Control-Allow-Origin "*";
        add_header Cache-Control "no-cache";
    }

    location /apps/sofia/ {
        alias /var/www/goosielabs/apps/sofia/dist/;
        try_files $uri $uri/ =404;
    }

    location /apps/catchzaps/api/ {
        proxy_pass http://127.0.0.1:3006/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Admin-Pin $http_x_admin_pin;
    }

    location /apps/catchzaps/ {
        alias /var/www/goosielabs/apps/catchzaps/dist/;
        try_files $uri $uri/ /apps/catchzaps/index.html;
    }

    location /apps/proofofmove/ {
        alias /var/www/goosielabs/apps/proofofmove/dist/;
        try_files $uri $uri/ /apps/proofofmove/index.html;
    }

    location /apps/zaphunt/api/ {
        proxy_pass http://127.0.0.1:3010/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /apps/zaphunt/ {
        alias /var/www/goosielabs/apps/zaphunt/dist/;
        try_files $uri $uri/ /apps/zaphunt/index.html;
    }

    location /apps/lastwill/ {
        alias /var/www/goosielabs/apps/lastwill/dist/;
        try_files $uri $uri/ =404;
    }

    location /apps/weddendat/ {
        alias /var/www/goosielabs/apps/weddendat/dist/;
        try_files $uri $uri/ =404;
    }

    location /apps/dilemma/ {
        alias /var/www/goosielabs/apps/dilemma/dist/;
        try_files $uri $uri/ =404;
    }

    location /apps/feedback/ {
        alias /var/www/goosielabs/apps/feedback/dist/;
        try_files $uri $uri/ =404;
    }

    location /apps/nospass/ {
        alias /var/www/goosielabs/apps/nospass/dist/;
        try_files $uri $uri/ =404;
    }

    location /apps/zinin/ {
        alias /var/www/goosielabs/apps/zinin/dist/;
        try_files $uri $uri/ /apps/zinin/index.html;
    }


    location /apps/proofofread/api/ {
        proxy_pass http://127.0.0.1:3002/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /apps/proofofread/ {
        alias /var/www/goosielabs/apps/proofofread/frontend/dist/;
        try_files $uri $uri/ /apps/proofofread/index.html;
    }

    location /apps/bookwriter/api/ {
        proxy_pass http://127.0.0.1:3003/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 360s;
    }

    location /apps/bookwriter/ {
        alias /var/www/goosielabs/apps/bookwriter/dist/;
        try_files $uri $uri/ /apps/bookwriter/index.html;
    }

    location = /apps {
        return 301 /#apps;
    }

    location = /apps/ {
        return 301 /#apps;
    }

    location /apps/onboarding/api/ {
        proxy_pass http://127.0.0.1:3005/api/;
    }

    location /apps/onboarding/ {
        alias /var/www/goosielabs/apps/onboarding/dist/;
        try_files $uri $uri/ /apps/onboarding/index.html;
    }

    location /apps/honkference/ {
        alias /var/www/goosielabs/apps/honkference/dist/;
        try_files $uri $uri/ /apps/honkference/index.html;
    }

    location /apps/test/ {
        alias /var/www/goosielabs/apps/test/dist/;
        try_files $uri $uri/ /apps/test/index.html;
    }

    location /apps/hellonsite/ {
        alias /var/www/goosielabs/apps/hellonsite/dist/;
        try_files $uri $uri/ /apps/hellonsite/index.html;
    }

    location /apps/georgie/ {
        alias /var/www/goosielabs/apps/georgie/dist/;
        try_files $uri $uri/ /apps/georgie/index.html;
    }

    location /apps/hoofddorp/ {
        alias /var/www/goosielabs/apps/hoofddorp/dist/;
        try_files $uri $uri/ /apps/hoofddorp/index.html;
    }


    location /apps/ {
        alias /var/www/goosielabs/apps/;
        try_files $uri $uri/ $uri/index.html =404;
    }

    # Claude Config — publieke AI configuratie viewer
    location /claude-config/ {
        alias /home/deploy/claude-config/;
        autoindex on;
        autoindex_exact_size off;
        autoindex_localtime on;
        disable_symlinks off;
        default_type text/plain;
        add_header Cache-Control "no-cache";
        add_header Access-Control-Allow-Origin "*";
    }

    location ~ /\.git {
        deny all;
        return 404;
    }

    location /relay {
        proxy_pass http://127.0.0.1:7778/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600;
    }

    location /webhook {
        proxy_pass http://localhost:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /testapje {
        alias /var/www/goosielabs/testapje;
        try_files $uri $uri/ /testapje/index.html;
    }

    # nsite — Perry's decentralized homepage
    location = / {
        proxy_pass http://127.0.0.1:3340/a80398e86c03ffadc7030fe135ee7614b6fabb204fc0f6641838fb4b8abf0b0c/index.html;
        proxy_set_header Host nsite.goosielabs.com;
        proxy_set_header Accept-Encoding "";
    }
    location ~ ^/(index\.html|about.*\.html|contact.*\.html|mcp\.html|bitcoin\.html)$ {
        proxy_pass http://127.0.0.1:3340/a80398e86c03ffadc7030fe135ee7614b6fabb204fc0f6641838fb4b8abf0b0c$request_uri;
        proxy_set_header Host nsite.goosielabs.com;
        proxy_set_header Accept-Encoding "";
    }

    location = /nostr-pill.js {
        alias /var/www/goosielabs/nostr-pill.js;
    }

    location ~ /\.ht {
        deny all;
    }
}

server {
    listen 80;
    server_name goosielabs.com www.goosielabs.com;

    location /koppenberg {
        root /var/www/goosielabs/koppenberg;
        try_files $uri $uri/ /koppenberg/index.html;
    }

    return 301 https://$host$request_uri;
}

# Blossom server — HTTP only until DNS A record is set + certbot runs
server {
    server_name blossom.goosielabs.com;

    location / {
        proxy_pass http://127.0.0.1:3339;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 55M;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/blossom.goosielabs.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/blossom.goosielabs.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}

# nsite gateway
server {
    server_name nsite.goosielabs.com;

    # App icons — served directly from the same dirs as goosielabs.com
    location ~ ^/apps/[a-z0-9-]+/icons/ {
        root /var/www/goosielabs;
        try_files $uri =404;
    }

    # HelloNsite app — same static files as goosielabs.com/apps/hellonsite/
    location /apps/hellonsite {
        alias /var/www/goosielabs/apps/hellonsite/dist;
        try_files $uri $uri/ /apps/hellonsite/index.html;
    }

    # Everything else: pubkey nsites + landing page → gateway
    location / {
        proxy_pass http://127.0.0.1:3340;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/nsite.goosielabs.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/nsite.goosielabs.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}

server {
    if ($host = nsite.goosielabs.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name nsite.goosielabs.com;
    return 404; # managed by Certbot


}
server {
    if ($host = blossom.goosielabs.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name blossom.goosielabs.com;
    return 404; # managed by Certbot


}
