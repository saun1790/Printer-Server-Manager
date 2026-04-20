#!/bin/bash
# ===========================================
# Startup script - CUPS + Node.js
# ===========================================

set -e

echo "============================================"
echo "🖨️  Printer Management System Starting..."
echo "============================================"

# Check if host CUPS socket is mounted
if [ -S /var/run/cups/cups.sock ]; then
    echo "✅ Host CUPS socket detected - using host CUPS server"
    echo "   Socket: /var/run/cups/cups.sock"
    
    # Verify host CUPS is accessible via the socket
    if lpstat -h /var/run/cups/cups.sock -r 2>/dev/null | grep -q "scheduler is running"; then
        echo "✅ Host CUPS is running and accessible"
        USE_HOST_CUPS=true
        # Set environment so all CUPS commands use the host socket
        export CUPS_SERVER=/var/run/cups/cups.sock
    else
        echo "⚠️  Host CUPS socket exists but scheduler not responding"
        echo "   (common on macOS Docker Desktop — Unix sockets can't cross the VM boundary)"
        echo "   Falling back to internal CUPS daemon"
        USE_HOST_CUPS=false
        # Explicitly tell Node.js NOT to use the socket
        export CUPS_SERVER=localhost
    fi
else
    echo "📦 No host CUPS socket - using internal CUPS server"
    USE_HOST_CUPS=false
    export CUPS_SERVER=localhost
fi

# Only start internal CUPS if not using host CUPS
if [ "$USE_HOST_CUPS" = false ]; then
    # If /etc/cups is persisted via a Docker volume, it may contain config from a previous
    # image/distro. Some directives are version-specific and can prevent CUPS from starting.
    if [ -f /etc/cups/cups-files.conf ] && grep -qE '^[[:space:]]*PeerCred\b' /etc/cups/cups-files.conf; then
        echo "🛠️  Patching legacy CUPS config (PeerCred) for compatibility..."
        sed -i 's/^[[:space:]]*PeerCred\b/# PeerCred/' /etc/cups/cups-files.conf || true
    fi

    # Create necessary directories
    mkdir -p /run/cups /var/spool/cups /var/log/cups

    # Start CUPS daemon
    echo "🖨️  Starting internal CUPS daemon..."
    /usr/sbin/cupsd -f &
    CUPS_PID=$!

    # Wait for CUPS to be ready
    echo "⏳ Waiting for CUPS to start..."
    for i in {1..30}; do
        if lpstat -r 2>/dev/null | grep -q "scheduler is running"; then
            echo "✅ Internal CUPS is running (PID: $CUPS_PID)"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "⚠️  CUPS startup timeout, continuing anyway..."
        fi
        sleep 1
    done
fi

# Show CUPS info
echo ""
echo "📊 CUPS Status:"
lpstat -r 2>/dev/null || echo "   Checking..."
echo ""

if [ "$USE_HOST_CUPS" = true ]; then
    echo "🌐 CUPS Web Interface: http://localhost:631 (host)"
else
    echo "🌐 CUPS Web Interface: http://localhost:631 (container)"
fi
echo ""

# List available printer drivers
echo "📦 Available printer models:"
lpinfo -m 2>/dev/null | head -5 || echo "   (loading...)"
echo "   ... and more (use 'lpinfo -m' for full list)"
echo ""

echo "============================================"
echo "🚀 Starting Node.js API Server..."
echo "============================================"

# Start Node.js (exec replaces the shell, keeping PID 1)
exec node src/index.js

