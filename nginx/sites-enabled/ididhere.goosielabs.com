server {
    server_name ididhere.goosielabs.com;
    root /var/www/goosielabs/apps/ididhere/frontend;
    index index.html;
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    location / {
        try_files $uri $uri/ /index.html;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/ididhere.goosielabs.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/ididhere.goosielabs.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}
server {
    if ($host = ididhere.goosielabs.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name ididhere.goosielabs.com;
    return 404; # managed by Certbot


}