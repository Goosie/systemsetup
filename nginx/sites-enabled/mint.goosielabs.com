server {
    listen 443 ssl;
    server_name mint.goosielabs.com;

    ssl_certificate /etc/letsencrypt/live/mint.goosielabs.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mint.goosielabs.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root /var/www/goosielabs/mint;
    index index.html;

    location = / {
        try_files /index.html =404;
    }

    location / {
        proxy_pass http://127.0.0.1:3338;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name mint.goosielabs.com;
    return 301 https://$host$request_uri;
}
