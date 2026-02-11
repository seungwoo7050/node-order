#!/bin/bash
set -euxo pipefail

apt-get update
apt-get install -y docker.io docker-compose-v2 jq
usermod -aG docker ubuntu # ubuntu 사용자가 sudo 없이 docker를 쓴다

fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/90-keys-only.conf
systemctl try-reload-or-restart ssh

install -d -o ubuntu -g ubuntu /opt/node-order
curl -fsSL -o /opt/node-order/rds-ca.pem "https://truststore.pki.rds.amazonaws.com/${AWS_REGION}/${AWS_REGION}-bundle.pem"
chown ubuntu:ubuntu /opt/node-order/rds-ca.pem
