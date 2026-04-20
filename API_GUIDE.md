# Printer Management API Guide

## Base URL

```
http://<server-ip>:8080/api
```

Example: `http://192.168.170.29:8080/api`

---

## Authentication

All API endpoints (except health check) require a JWT token.

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@printer.local",
  "password": "Admin123!"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "a1b2c3d4-e5f6-...",
  "expiresIn": 3600,
  "user": {
    "id": 1,
    "email": "admin@printer.local",
    "name": "Administrator",
    "role": "admin"
  }
}
```

### Use the token in all requests

```http
Authorization: Bearer <accessToken>
```

### Refresh Token

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "a1b2c3d4-e5f6-..."
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 3600
}
```

### Get Current User

```http
GET /api/auth/me
Authorization: Bearer <accessToken>
```

### Logout

```http
POST /api/auth/logout
Content-Type: application/json

{
  "refreshToken": "a1b2c3d4-e5f6-..."
}
```

### Change Password

```http
PUT /api/auth/password
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "currentPassword": "Admin123!",
  "newPassword": "NewSecurePass123!"
}
```

> Tokens expire after **7 days** by default (configurable via `JWT_EXPIRY` env var). Refresh tokens expire after **30 days**.

---

## Health Check (No Auth)

```http
GET /api/system/health
```

```json
{
  "status": "healthy",
  "timestamp": "2026-04-20T12:00:00.000Z",
  "uptime": 86400,
  "database": "connected"
}
```

---

## Printers

### List All Printers

```http
GET /api/printers
Authorization: Bearer <token>
```

### Get Printer by ID

```http
GET /api/printers/:id
Authorization: Bearer <token>
```

### Add Printer

```http
POST /api/printers
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "KITCHEN",
  "ip_address": "192.168.170.22",
  "port": 9100,
  "protocol": "socket",
  "location": "Kitchen Station",
  "description": "Kitchen receipt printer",
  "manufacturer": "EPSON",
  "model": "TM-T20III"
}
```

**Required Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name (e.g., "KITCHEN", "BAR") |
| `ip_address` | string | Printer IP address |

**Optional Fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | integer | 9100 | Printer port (9100 for socket, 631 for IPP) |
| `protocol` | string | `"ipp"` | `socket`, `ipp`, `ipps`, `lpd` |
| `location` | string | null | Physical location |
| `description` | string | null | Additional description |
| `manufacturer` | string | null | e.g., "EPSON", "SNBC" |
| `model` | string | null | e.g., "TM-T20III" |
| `driver` | string | auto-detect | CUPS driver (auto-detected from manufacturer/model) |
| `tags` | string | null | Comma-separated tags for filtering |

### Update Printer

```http
PUT /api/printers/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "KITCHEN-MAIN",
  "location": "Kitchen - Main Station"
}
```

### Delete Printer

```http
DELETE /api/printers/:id
Authorization: Bearer <token>
```

### Set Default Printer

```http
POST /api/printers/:id/set-default
Authorization: Bearer <token>
```

---

## Discovery

### Scan Network

```http
POST /api/discovery/scan
Authorization: Bearer <token>
Content-Type: application/json

{
  "network": "192.168.170.0/24"
}
```

### Add All Discovered Printers

```http
POST /api/discovery/add-all
Authorization: Bearer <token>
Content-Type: application/json

{
  "printers": [
    { "ip": "192.168.170.22", "port": 9100, "name": "Kitchen Printer" }
  ]
}
```

---

## Printing

### Print Test Page

```http
POST /api/print/test
Authorization: Bearer <token>
Content-Type: application/json

{
  "printer_id": 1
}
```

### Print File (multipart upload)

```http
POST /api/print/file
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary>
printer_id: 1
copies: 1
```

Supported file types: PDF, TXT, JPG, PNG, GIF, PS, DOC, DOCX, XLS, XLSX (max 50MB).

### Print Raw Text

```http
POST /api/print/text
Authorization: Bearer <token>
Content-Type: application/json

{
  "printer_id": 1,
  "text": "Hello World",
  "title": "Test Document",
  "copies": 1
}
```

### Print Raw ESC/POS Data (POS Integration)

```http
POST /api/print/raw
Authorization: Bearer <token>
Content-Type: application/json

{
  "printer": "KITCHEN",
  "data": "G0BFc2MvUE9TIGJhc2U2NCBkYXRh",
  "cut": true
}
```

`data` is Base64-encoded ESC/POS binary data. Alternatively, use `text` instead of `data` for plain text.

You can also print by IP directly (bypasses CUPS):

```json
{
  "ip": "192.168.170.22",
  "port": 9100,
  "text": "Receipt text here",
  "cut": true
}
```

### Print Receipt (Formatted)

```http
POST /api/print/receipt
Authorization: Bearer <token>
Content-Type: application/json

{
  "printer": "KITCHEN",
  "header": "MY RESTAURANT",
  "lines": [
    "Table: 5",
    "Server: John",
    "--------------------------------",
    {"text": "1x Burger         $12.99", "bold": false},
    {"text": "1x Fries           $4.99", "bold": false},
    "--------------------------------",
    {"text": "TOTAL:            $17.98", "bold": true, "align": "right"}
  ],
  "footer": "Thank you! Come again!",
  "cut": true,
  "feedLines": 5
}
```

---

## Print Queue

### Get Queue

```http
GET /api/print/queue
GET /api/print/queue?printer=KITCHEN
Authorization: Bearer <token>
```

### Cancel Job

```http
DELETE /api/print/queue/:cupsJobId
Authorization: Bearer <token>
```

---

## Print Options

### Get Printer Options

```http
GET /api/print/options/:printerId
Authorization: Bearer <token>
```

Returns available CUPS options (paper size, duplex, etc.) for the printer.

---

## Jobs

### List Jobs

```http
GET /api/jobs
GET /api/jobs?printer_id=1&status=completed&limit=50
Authorization: Bearer <token>
```

---

## Reports

### Get Printer Statistics

```http
GET /api/reports/stats
GET /api/reports/stats?days=30
Authorization: Bearer <token>
```

---

## Users (Admin Only)

### List Users

```http
GET /api/users
Authorization: Bearer <token>
```

### Create User

```http
POST /api/users
Authorization: Bearer <token>
Content-Type: application/json

{
  "email": "operator@printer.local",
  "password": "SecurePass123!",
  "name": "Operator User",
  "role": "operator"
}
```

Roles: `admin`, `operator`, `viewer`

---

## Notifications

### List Notifications

```http
GET /api/notifications
Authorization: Bearer <token>
```

### Mark as Read

```http
PUT /api/notifications/:id/read
Authorization: Bearer <token>
```

---

## Maintenance

### Check Maintenance Status

```http
GET /api/maintenance/is-active
Authorization: Bearer <token>
```

---

## System

### Health Check

```http
GET /api/system/health
```

### System Info

```http
GET /api/system/info
Authorization: Bearer <token>
```

---

## cURL Examples

### Full Workflow: Login → Add Printer → Test Print

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://192.168.170.29:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@printer.local","password":"Admin123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

echo "Token: $TOKEN"

# 2. Add printer
curl -s -X POST http://192.168.170.29:8080/api/printers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "KITCHEN",
    "ip_address": "192.168.170.22",
    "port": 9100,
    "protocol": "socket",
    "location": "Kitchen"
  }' | python3 -m json.tool

# 3. Test print (use the printer ID returned above)
curl -s -X POST http://192.168.170.29:8080/api/print/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"printer_id": 1}' | python3 -m json.tool

# 4. List printers
curl -s http://192.168.170.29:8080/api/printers \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Python Example

```python
import requests

BASE = "http://192.168.170.29:8080/api"

# Login
r = requests.post(f"{BASE}/auth/login", json={
    "email": "admin@printer.local",
    "password": "Admin123!"
})
token = r.json()["accessToken"]
headers = {"Authorization": f"Bearer {token}"}

# List printers
printers = requests.get(f"{BASE}/printers", headers=headers).json()
print(printers)

# Print raw text to a printer
requests.post(f"{BASE}/print/raw", headers=headers, json={
    "printer": "KITCHEN",
    "text": "Order #1234\n2x Tacos\n1x Margarita\n",
    "cut": True
})
```
