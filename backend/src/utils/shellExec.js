// ===========================================
// Shell Command Executor
// ===========================================

const { exec, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const logger = require('./logger');

// Check if CUPS socket should be used.
// Trust the CUPS_SERVER env var (set by start.sh after runtime validation)
// rather than just checking file existence — a mounted socket from macOS host
// passes fs.existsSync but is non-functional inside Docker Desktop's Linux VM.
const CUPS_SOCKET = '/var/run/cups/cups.sock';
const cupsServerEnv = process.env.CUPS_SERVER || '';
let USE_CUPS_SOCKET = cupsServerEnv.startsWith('/') && fs.existsSync(cupsServerEnv);

if (USE_CUPS_SOCKET) {
    logger.info(`CUPS socket mode enabled via CUPS_SERVER=${cupsServerEnv}`);
} else {
    logger.info(`CUPS using local daemon (CUPS_SERVER=${cupsServerEnv || 'localhost'})`);
}

// Default environment with CUPS_SERVER for all commands
const CUPS_ENV = {
    ...process.env,
    CUPS_SERVER: cupsServerEnv || 'localhost'
};

/**
 * Validate CUPS socket is actually usable (not a dead mount).
 * Call once at startup to disable socket mode if broken.
 */
async function validateCupsSocket() {
    if (!USE_CUPS_SOCKET) return;
    
    return new Promise((resolve) => {
        const sock = net.createConnection(cupsServerEnv);
        const timer = setTimeout(() => {
            sock.destroy();
            logger.warn(`CUPS socket ${cupsServerEnv} timed out — falling back to local CUPS`);
            USE_CUPS_SOCKET = false;
            CUPS_ENV.CUPS_SERVER = 'localhost';
            resolve(false);
        }, 3000);
        
        sock.on('connect', () => {
            clearTimeout(timer);
            sock.destroy();
            logger.info(`CUPS socket ${cupsServerEnv} validated OK`);
            resolve(true);
        });
        
        sock.on('error', (err) => {
            clearTimeout(timer);
            sock.destroy();
            logger.warn(`CUPS socket ${cupsServerEnv} not usable (${err.message}) — falling back to local CUPS`);
            USE_CUPS_SOCKET = false;
            CUPS_ENV.CUPS_SERVER = 'localhost';
            resolve(false);
        });
    });
}

// Run validation on module load (non-blocking)
validateCupsSocket().catch(() => {});

/**
 * Execute a shell command and return promise with output
 */
function execCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
        const timeout = options.timeout || 30000; // 30 seconds default
        
        logger.debug(`Executing command: ${command}`);
        
        // Include CUPS_SERVER in environment for all commands
        const env = { ...CUPS_ENV, ...(options.env || {}) };
        
        exec(command, { timeout, env, ...options }, (error, stdout, stderr) => {
            if (error) {
                logger.error(`Command failed: ${command}`, { error: error.message, stderr });
                reject({
                    success: false,
                    error: error.message,
                    stderr,
                    code: error.code
                });
                return;
            }
            
            resolve({
                success: true,
                stdout: stdout.trim(),
                stderr: stderr.trim()
            });
        });
    });
}

/**
 * Execute CUPS command with socket support
 * Automatically adds -h socket path when running in Docker with mounted socket
 */
function execCupsCommand(command, options = {}) {
    let finalCommand = command;
    
    // Add socket path to CUPS commands when socket is available
    if (USE_CUPS_SOCKET) {
        // Commands that support -h option: lpadmin, lpstat, lp, lpinfo, lpoptions, cupsenable, cupsaccept, cupsreject, cupsdisable, cancel
        const cupsCommands = ['lpadmin', 'lpstat', 'lp ', 'lpinfo', 'lpoptions', 'cupsenable', 'cupsaccept', 'cupsreject', 'cupsdisable', 'cancel'];
        
        for (const cmd of cupsCommands) {
            if (command.startsWith(cmd) || command.includes(` ${cmd}`)) {
                // Insert -h option after the command name
                finalCommand = command.replace(new RegExp(`^(${cmd.trim()})`), `$1 -h ${CUPS_SOCKET}`);
                break;
            }
        }
    }
    
    return execCommand(finalCommand, options);
}

/**
 * Execute command with streaming output
 */
function execStreamCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, options);
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, stdout, stderr, code });
            } else {
                reject({ success: false, stdout, stderr, code });
            }
        });
        
        proc.on('error', (error) => {
            reject({ success: false, error: error.message, code: -1 });
        });
    });
}

/**
 * Ping a host to check connectivity
 */
async function pingHost(ip, count = 3, timeout = 2) {
    try {
        // Linux/Alpine ping syntax
        const result = await execCommand(`ping -c ${count} -W ${timeout} ${ip}`);
        
        // Parse ping output
        const lines = result.stdout.split('\n');
        const statsLine = lines.find(l => l.includes('packets transmitted'));
        
        if (statsLine) {
            const match = statsLine.match(/(\d+) packets transmitted, (\d+) (?:packets )?received/);
            if (match) {
                const sent = parseInt(match[1]);
                const received = parseInt(match[2]);
                const loss = ((sent - received) / sent) * 100;
                
                return {
                    success: received > 0,
                    sent,
                    received,
                    packetLoss: loss,
                    raw: result.stdout
                };
            }
        }
        
        return { success: true, raw: result.stdout };
    } catch (error) {
        return { success: false, error: error.error || error.message };
    }
}

/**
 * Sanitize input for shell commands (prevent injection)
 */
function sanitizeForShell(input) {
    if (!input) return '';
    // Remove dangerous characters
    return input.toString()
        .replace(/[;&|`$(){}[\]<>\\'"!#*?~]/g, '')
        .trim();
}

/**
 * Validate IP address format
 */
function isValidIP(ip) {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    
    if (ipv4Regex.test(ip)) {
        const parts = ip.split('.');
        return parts.every(part => {
            const num = parseInt(part);
            return num >= 0 && num <= 255;
        });
    }
    
    return ipv6Regex.test(ip);
}

/**
 * Validate hostname/DNS format
 */
function isValidHostname(hostname) {
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return hostnameRegex.test(hostname) && hostname.length <= 253;
}

module.exports = {
    execCommand,
    execCupsCommand,
    execStreamCommand,
    pingHost,
    sanitizeForShell,
    isValidIP,
    isValidHostname
};
