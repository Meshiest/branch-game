#!/bin/bash
openssl req -x509 -nodes -days 365 \
-newkey rsa:2048 -keyout ./ssl/key.key -out ./ssl/cert.crt
