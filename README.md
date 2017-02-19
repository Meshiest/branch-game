# Branch

### Welcome

Branch is a competitive dueling game where players' armies fight and level up *in versions* better than they were before

### Let's Encrypt

1. Certbot while Branch is running, webroot is `./frontend`
2. Generate a dhparam: `sudo openssl dhparam -out /etc/ssl/certs/dhparam.pem 2048`
3. Use `letsencrypt-docker-compose.yml` and `letsencrypt-nginx.conf` in place of `docker-compose.yml` and `nginx.conf` respectively. Make sure to change `example.com` to your domain

### Authors

* Katie - All of the Art
* Noah - Design, Core Mechanics, Balancing
* Jake - Design, Core Mechanics, Balancing,
* David - Design, Softcoding
* Isaac - Design, Application

### Special Thanks

* Burns - Playtesting, QA
* Adam - Playtesting
* Alex - Playtesting
* Avneet - Playtesting
* Jamie - Playtesting
* Jared - Playtesting
* PJ - Playtesting
* Taber - Playtesting
