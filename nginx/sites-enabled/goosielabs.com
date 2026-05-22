server {
    listen 443 ssl;
    server_name goosielabs.com www.goosielabs.com;
    location /koppenberg { root /var/www/goosielabs/koppenberg; try_files $uri $uri/ /koppenberg/index.html; }
    root /var/www/goosielabs;
    index index.php index.html;

    ssl_certificate /etc/letsencrypt/live/www.goosielabs.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.goosielabs.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;



    location /apps/testtrip/ {
        alias /var/www/goosielabs/apps/testtrip/dist/;
        try_files $uri $uri/ =404;
    }

    location /apps/sofia/ {
        alias /var/www/goosielabs/apps/sofia/dist/;
        try_files $uri $uri/ =404;
    }

    location /apps/mobile/ {
        alias /var/www/goosielabs/apps/mobile/dist/;
        try_files $uri $uri/ =404;
    }

    location /apps/zap-hunt/api/ {
        proxy_pass http://127.0.0.1:3002/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Admin-Pin $http_x_admin_pin;
    }

    location /apps/zap-hunt/ {
        alias /var/www/goosielabs/apps/zap-hunt/dist/;
        try_files $uri $uri/ /apps/zap-hunt/index.html;
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

    location /apps/test3/ {
        alias /var/www/goosielabs/apps/test3/dist/;
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


    location /apps/ {
       alias /var/www/goosielabs/apps/;
       try_files $uri $uri/ $uri/index.html =404;
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

    location / {
        try_files $uri $uri/ /index.php?$args;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param HTTP_AUTHORIZATION $http_authorization;
    }

    location ~ /\.ht {
        deny all;
    }
}

server {
    listen 80;
    server_name goosielabs.com www.goosielabs.com;
    location /koppenberg { root /var/www/goosielabs/koppenberg; try_files $uri $uri/ /koppenberg/index.html; }
    return 301 https://$host$request_uri;
}
