# 🖨️ Printer Management System - Installation Guide

Complete copy-paste guide to deploy the system with Docker on Ubuntu/Debian.

---

## 📋 Table of Contents

1. [Requirements](#requirements)
2. [Install Docker](#step-1-install-docker)
3. [Clone & Configure](#step-2-clone--configure)
4. [Deploy](#step-3-deploy)
5. [First Login](#step-4-first-login)
6. [CUPS Configuration (Host)](#step-5-cups-configuration)
7. [Verify Everything Works](#step-6-verify)
8. [Adding Printers](#adding-printers)
9. [Maintenance & Backup](#maintenance--backup)
10. [Troubleshooting](#troubleshooting)

---

## Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| OS | Ubuntu 22.04 LTS / Debian 12 | Ubuntu 24.04 LTS |
| CPU | 2 cores | 4 cores |
| RAM | 2 GB | 4 GB |
| Storage | 20 GB | 50 GB |
| Network | 100 Mbps | 1 Gbps |

### Ports Used

| Port | Service | Access |
|------|---------|--------|
| **8080** | Web UI (Nginx) | External — your users connect here |
| 3000 | Backend API | Internal (Docker network only) |
| 3307 | MySQL | Internal (exposed for debugging) |
| 631 | CUPS | Host only (printer admin web interface) |

---

## Step 1: Install Docker

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y ca-certificates curl gnupg lsb-release

# Add Docker GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add your user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

---

## Step 2: Clone & Configure

```bash
# Clone the repository
cd ~
git clone https://github.com/YOUR_ORG/TequilaPOS-Printer-Management.git
cd TequilaPOS-Printer-Management

# Create your .env file from the example
cp .env.example .env
```

Now edit `.env` with your values:

```bash
nano .env
```

**Minimum required changes** (replace the placeholder values):

```dotenv
# ===========================================
# MySQL Database
# ===========================================
MYSQL_ROOT_PASSWORD=YourSecureRootPass123!
MYSQL_DATABASE=printer_management
MYSQL_USER=printer_admin
MYSQL_PASSWORD=YourSecurePass123!

# ===========================================
# JWT Authentication (CHANGE THESE!)
# ===========================================
JWT_SECRET=change_this_to_a_random_string_at_least_32_chars
JWT_REFRESH_SECRET=change_this_to_another_random_string_32_chars

# ===========================================
# URLs
# ===========================================
FRONTEND_URL=http://YOUR_SERVER_IP:8080
VITE_API_URL=/api

# ===========================================
# Timezone
# ===========================================
TZ=America/Chicago

# ===========================================
# Driver Pack: lite (default) | common | full
# ===========================================
DRIVER_SET=lite

# ===========================================
# CUPS (host socket - leave as-is for production)
# ===========================================
CUPS_SERVER=/var/run/cups/cups.sock

# ===========================================
# Network for printer discovery (optional)
# ===========================================
DEFAULT_NETWORK=192.168.170.0/24

# ===========================================
# SMTP Email (optional)
# ===========================================
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

> 💡 **Tip:** Generate random JWT secrets with: `openssl rand -hex 32`

---

## Step 3: Deploy

### 3a. Build and Start

```bash
cd ~/TequilaPOS-Printer-Management

# Build all containers
docker compose build

# Start all services
docker compose up -d

# Watch the logs to confirm everything starts
docker compose logs -f --tail 50
```

Wait until you see:
```
printer-backend   | 🚀 Server running on port 3000
printer-backend   | ✅ Database connection established
```

Press `Ctrl+C` to exit the logs.

### 3b. Database Initialization

The database schema and default admin user are created **automatically** on first start. The `init.sql` file is mounted into MySQL's init directory and executed when the database volume is created for the first time.

**Verify the database was created:**

```bash
docker exec printer-mysql mysql -u root -p"$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)" -e "USE printer_management; SHOW TABLES;"
```

You should see these tables:

```
+-------------------------------+
| Tables_in_printer_management  |
+-------------------------------+
| maintenance_schedule          |
| notification_configs          |
| notifications                 |
| print_jobs                    |
| printer_stats_daily           |
| printers                      |
| refresh_tokens                |
| settings                      |
| system_logs                   |
| users                         |
+-------------------------------+
```

### 3c. Verify All Services

```bash
# Check all containers are running
docker compose ps

# Expected: all 4 containers show "running (healthy)"
#   printer-mysql     running (healthy)
#   printer-backend   running (healthy)
#   printer-frontend  running (healthy)
#   printer-nginx     running (healthy)

# Quick health check
curl -s http://localhost:8080/api/system/health
# Returns: {"status":"healthy", "database":"connected", ...}
```

---

## Step 4: First Login

Open your browser and go to:

```
http://YOUR_SERVER_IP:8080
```

**Default admin credentials:**

| Field | Value |
|-------|-------|
| **Email** | `admin@printer.local` |
| **Password** | `Admin123!` |

> ⚠️ **Change the admin password immediately** after first login via Profile → Change Password.

---

## Step 5: CUPS Configuration

The system uses the **host's CUPS** service (not an internal one) via a mounted Unix socket (`/run/cups/cups.sock`). This lets the Docker container manage printers through the host's native CUPS.

### 5a. Install CUPS on the Host

```bash
# Remove Snap version if present (Snap CUPS causes socket issues)
sudo snap remove cups 2>/dev/null

# Install native CUPS
sudo apt install -y cups cups-client cups-bsd

# Add your user to lpadmin group (required for CUPS admin)
sudo usermod -aG lpadmin $USER

# Enable and start CUPS
sudo systemctl enable cups
sudo systemctl start cups
```

### 5b. Configure CUPS to Listen on All Interfaces

By default CUPS only listens on `localhost`. We need it to accept connections from the local network and Docker containers.

```bash
# Backup original config
sudo cp /etc/cups/cupsd.conf /etc/cups/cupsd.conf.bak

# Apply the correct configuration
sudo tee /etc/cups/cupsd.conf > /dev/null << 'CUPSEOF'
LogLevel warn
PageLogFormat
MaxLogSize 0
ErrorPolicy retry-job

# Listen on all interfaces + Unix socket
Listen *:631
Listen /run/cups/cups.sock

Browsing No
BrowseLocalProtocols dnssd
DefaultAuthType Basic
WebInterface Yes
IdleExitTimeout 60

# Server access (local network + Docker networks)
<Location />
  Order allow,deny
  Allow @LOCAL
  Allow from 192.168.0.0/16
  Allow from 172.16.0.0/12
  Allow from 10.0.0.0/8
  Allow from 127.0.0.1
</Location>

# Admin pages
<Location /admin>
  AuthType Default
  Require user @SYSTEM
  Order allow,deny
  Allow @LOCAL
  Allow from 192.168.0.0/16
  Allow from 172.16.0.0/12
  Allow from 127.0.0.1
</Location>

# Config files
<Location /admin/conf>
  AuthType Default
  Require user @SYSTEM
  Order allow,deny
  Allow @LOCAL
  Allow from 192.168.0.0/16
  Allow from 127.0.0.1
</Location>

# Log files
<Location /admin/log>
  AuthType Default
  Require user @SYSTEM
  Order allow,deny
  Allow @LOCAL
  Allow from 192.168.0.0/16
  Allow from 127.0.0.1
</Location>

# Default job policies
<Policy default>
  JobPrivateAccess default
  JobPrivateValues default
  SubscriptionPrivateAccess default
  SubscriptionPrivateValues default

  <Limit Create-Job Print-Job Print-URI Validate-Job>
    Order deny,allow
  </Limit>

  <Limit Send-Document Send-URI Hold-Job Release-Job Restart-Job Purge-Jobs Set-Job-Attributes Create-Job-Subscription Renew-Subscription Cancel-Subscription Get-Notifications Reprocess-Job Cancel-Current-Job Suspend-Current-Job Resume-Job Cancel-My-Jobs Close-Job CUPS-Move-Job>
    Require user @OWNER @SYSTEM
    Order deny,allow
  </Limit>

  <Limit CUPS-Get-Document>
    AuthType Default
    Require user @OWNER @SYSTEM
    Order deny,allow
  </Limit>

  <Limit CUPS-Add-Modify-Printer CUPS-Delete-Printer CUPS-Add-Modify-Class CUPS-Delete-Class CUPS-Set-Default CUPS-Get-Devices>
    AuthType Default
    Require user @SYSTEM
    Order deny,allow
  </Limit>

  <Limit Pause-Printer Resume-Printer Enable-Printer Disable-Printer Pause-Printer-After-Current-Job Hold-New-Jobs Release-Held-New-Jobs Deactivate-Printer Activate-Printer Restart-Printer Shutdown-Printer Startup-Printer Promote-Job Schedule-Job-After Cancel-Jobs CUPS-Accept-Jobs CUPS-Reject-Jobs>
    AuthType Default
    Require user @SYSTEM
    Order deny,allow
  </Limit>

  <Limit Cancel-Job>
    Require user @OWNER @SYSTEM
    Order deny,allow
  </Limit>

  <Limit CUPS-Authenticate-Job>
    AuthType Default
    Require user @OWNER @SYSTEM
    Order deny,allow
  </Limit>

  <Limit All>
    Order deny,allow
  </Limit>
</Policy>
CUPSEOF

# Restart CUPS
sudo systemctl restart cups
```

### 5c. Verify CUPS

```bash
# Check CUPS is listening on all interfaces
ss -tlnp | grep 631
# ✅ Should show: 0.0.0.0:631 (NOT 127.0.0.1:631)

# Check web interface
curl -s -o /dev/null -w "%{http_code}" http://localhost:631/
# ✅ Should return: 200

# Check socket permissions
ls -la /run/cups/cups.sock
# ✅ Should show: srw-rw-rw-

# If permissions are too restrictive:
sudo chmod 666 /run/cups/cups.sock
```

### 5d. Verify Docker Can Access CUPS

```bash
# The container should see the host's CUPS via the socket
docker exec printer-backend lpstat -r
# ✅ Should show: scheduler is running

docker exec printer-backend lpstat -v
# Lists any printers already configured in CUPS
```

### 5e. CUPS Admin Web Interface

Access **http://YOUR_SERVER_IP:631** from your browser. Login with your **Linux username** and password (must be in the `lpadmin` group).

### 5f. Open Firewall (if using UFW)

```bash
sudo ufw allow 8080/tcp    # Web UI
sudo ufw allow 631/tcp     # CUPS admin interface (optional)
```

---

## Step 6: Verify

Run this full verification script:

```bash
echo "=== Docker Containers ==="
docker compose ps --format "table {{.Name}}\t{{.Status}}"

echo ""
echo "=== Backend Health ==="
curl -s http://localhost:8080/api/system/health | python3 -m json.tool

echo ""
echo "=== CUPS Status ==="
docker exec printer-backend lpstat -r

echo ""
echo "=== Login Test ==="
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@printer.local","password":"Admin123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

if [ -n "$TOKEN" ] && [ "$TOKEN" != "None" ]; then
    echo "✅ Login successful"
    curl -s http://localhost:8080/api/auth/me \
      -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
else
    echo "❌ Login failed"
fi
```

---

## Adding Printers

### Via Web UI
1. Go to **http://YOUR_SERVER_IP:8080**
2. Navigate to **Discovery** → Scan your network
3. Select discovered printers → **Add All**

### Via API
```bash
# Get auth token
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@printer.local","password":"Admin123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# Add a printer
curl -s -X POST http://localhost:8080/api/printers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "KITCHEN",
    "ip_address": "192.168.170.22",
    "port": 9100,
    "protocol": "socket",
    "location": "Kitchen"
  }' | python3 -m json.tool
```

### Test Printing

```bash
# Send test print via API
PRINTER_ID=1  # Change to your printer's ID

curl -s -X POST http://localhost:8080/api/print/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"printer_id\": $PRINTER_ID}" | python3 -m json.tool

# Or test directly from the host via CUPS
echo "TEST PRINT" | lp -d printer_cups_name -o raw

# Or bypass CUPS entirely (raw socket)
echo "DIRECT TEST" | nc -w 3 192.168.170.22 9100
```

---

## Maintenance & Backup

### Database Backup

```bash
# Backup
docker exec printer-mysql mysqldump -u root \
  -p"$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)" \
  printer_management > backup_$(date +%Y%m%d).sql

# Restore
cat backup_YYYYMMDD.sql | docker exec -i printer-mysql mysql -u root \
  -p"$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)" printer_management
```

### Update the System

```bash
cd ~/TequilaPOS-Printer-Management
git pull
docker compose build
docker compose up -d
```

### View Logs

```bash
# All services
docker compose logs -f --tail 100

# Backend only
docker logs printer-backend --tail 50 -f

# CUPS logs (on host)
sudo tail -50 /var/log/cups/error_log
```

### Reset Database (⚠️ destroys all data)

```bash
docker compose down
docker volume rm $(docker volume ls -q | grep mysql_data)
docker compose up -d
# Wait 30s for MySQL to re-initialize. Schema + admin user are recreated automatically.
```

---

## Troubleshooting

### Container won't start

```bash
docker compose logs backend --tail 50
docker compose logs mysql --tail 50

# Full rebuild
docker compose down
docker compose build --no-cache
docker compose up -d
```

### "Connection refused" on port 8080

```bash
docker compose ps nginx
docker exec printer-nginx nginx -t
ss -tlnp | grep 8080
```

### CUPS: "Unable to connect to server: Bad file descriptor"

```bash
# Is CUPS running?
sudo systemctl status cups

# Socket exists and has correct permissions?
ls -la /run/cups/cups.sock
sudo chmod 666 /run/cups/cups.sock

# Restart backend
docker compose restart backend
```

### CUPS web shows "Forbidden"

Re-run the full CUPS configuration in [Step 5b](#5b-configure-cups-to-listen-on-all-interfaces).

### Login returns "Invalid credentials"

```bash
# Check the admin user exists
docker exec printer-mysql mysql -u root \
  -p"$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)" \
  printer_management -e "SELECT id, email, role, is_active FROM users;"

# Recreate admin user if missing (password: Admin123!)
docker exec -i printer-mysql mysql -u root \
  -p"$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)" printer_management << 'SQL'
INSERT INTO users (email, password, name, role, is_active) VALUES 
('admin@printer.local', '$2b$10$GMxlXLcQOrod83fNFcsDN.uyOMWNCTFEIlgx36CbyJ4GMS5ArwmTu', 'Administrator', 'admin', TRUE)
ON DUPLICATE KEY UPDATE password = '$2b$10$GMxlXLcQOrod83fNFcsDN.uyOMWNCTFEIlgx36CbyJ4GMS5ArwmTu';
SQL
```

### Printers added but jobs don't print

```bash
# 1. Test network connectivity
nc -zv 192.168.170.22 9100

# 2. Test raw print (bypasses CUPS)
echo "DIRECT TEST" | nc -w 3 192.168.170.22 9100

# 3. Test via CUPS
echo "CUPS TEST" | lp -d printer_name -o raw

# 4. Check job queue
lpstat -W completed | head -5
lpstat -W not-completed

# 5. Check CUPS logs
sudo tail -30 /var/log/cups/error_log
```

### macOS Development (Docker Desktop)

On macOS, Unix sockets can't cross the Docker Desktop VM boundary. The system will automatically detect this and fall back to the internal CUPS daemon. This is expected for local development.

For macOS dev, use the `docker-compose.override.yml` which enables the internal CUPS and exposes port 631.
