#!/bin/bash

# Setup SSL for personal-meditations.com
echo "🔧 Setting up SSL for personal-meditations.com..."

# Install certbot
apt update
apt install -y certbot

# Stop any existing services on port 80/443
docker compose down 2>/dev/null || true
systemctl stop nginx 2>/dev/null || true

# Get SSL certificate
echo "📜 Obtaining SSL certificate..."
certbot certonly --standalone \
  --email ilgiz@personal-meditations.com \
  --agree-tos \
  --no-eff-email \
  -d personal-meditations.com

# Check if certificate was obtained
if [ ! -f "/etc/letsencrypt/live/personal-meditations.com/fullchain.pem" ]; then
    echo "❌ Failed to obtain SSL certificate"
    exit 1
fi

echo "✅ SSL certificate obtained successfully"

# Setup auto-renewal
echo "🔄 Setting up auto-renewal..."
(crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet --deploy-hook 'docker compose -f /opt/audio-processor/docker-compose.yml restart nginx'") | crontab -

echo "🚀 Starting services with SSL..."
docker compose up -d --build

echo "✅ Setup complete!"
echo "🌐 Your API is now available at:"
echo "   https://personal-meditations.com/api/process-base64"
echo "   https://personal-meditations.com/health"
