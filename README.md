<div align="center" width="100%">
    <img src="./public/icon.svg" width="128" alt="Uptime Kuma Logo" />
</div>

# Uptime Kuma Fork

Uptime Kuma is an easy-to-use self-hosted monitoring tool.

<img src="https://user-images.githubusercontent.com/1336778/212262296-e6205815-ad62-488c-83ec-a5b0d0689f7c.jpg" width="700" alt="Uptime Kuma Dashboard Screenshot" />

## Additions added in mcgeezy/uptime-kuma

- NTP Monitor
- Added static network gateway to docker-compose.yaml for tests to localhost.  Use 172.25.0.1 for tests to services running on host.
  
## ⭐ Features

- Monitoring uptime for HTTP(s) / TCP / HTTP(s) Keyword / HTTP(s) Json Query / Websocket / Ping / DNS Record / Push / Steam Game Server / Docker Containers
- Fancy, Reactive, Fast UI/UX
- Notifications via Telegram, Discord, Gotify, Slack, Pushover, Email (SMTP), and [90+ notification services, click here for the full list](https://github.com/louislam/uptime-kuma/tree/master/src/components/notifications)
- 20-second intervals
- [Multi Languages](https://github.com/louislam/uptime-kuma/tree/master/src/lang)
- Multiple status pages
- Map status pages to specific domains
- Ping chart
- Certificate info
- Proxy support
- 2FA support

## 🔧 How to Install

### 🐳 mcgeezy/uptime-kuma repo build

```bash
mkdir uptime-kuma
cd uptime-kuma
git clone https://github.com/mcgeezy/uptime-kuma.git .
docker compose up -d --build
```

Uptime Kuma is now running on all network interfaces (e.g. http://localhost:3001 or http://your-ip:3001).

> [!WARNING]
> File Systems like **NFS** (Network File System) are **NOT** supported. Please map to a local directory or volume.

## 🆙 How to Update

```bash
cd uptime-kuma
git pull
docker compose up -d --build
```

## 🖼 More Screenshots

NTP Monitor:

<img src="public/Screenshot from 2026-06-02 19-51-25.png"  width="512" alt="Uptime Kuma NTP Monitor Configuration Page" />

Light Mode:

<img src="https://uptime.kuma.pet/img/light.jpg" width="512" alt="Uptime Kuma Light Mode Screenshot of how the Dashboard looks" />

Status Page:

<img src="https://user-images.githubusercontent.com/1336778/134628766-a3fe0981-0926-4285-ab46-891a21c3e4cb.png" width="512" alt="Uptime Kuma Status Page Screenshot" />

Settings Page:

<img src="https://louislam.net/uptimekuma/2.jpg" width="400" alt="Uptime Kuma Settings Page Screenshot" />

Telegram Notification Sample:

<img src="https://louislam.net/uptimekuma/3.jpg" width="400" alt="Uptime Kuma Telegram Notification Sample Screenshot" />

