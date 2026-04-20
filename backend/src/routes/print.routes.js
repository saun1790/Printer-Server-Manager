// ===========================================
// Print Routes - Upload & Print Files
// ===========================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const cupsService = require('../services/cupsServiceV2');
const { authenticateToken, requireRole, logAction } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = '/tmp/print_uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const fileFilter = (req, file, cb) => {
    // Allowed file types
    const allowedTypes = [
        'application/pdf',
        'text/plain',
        'image/jpeg',
        'image/png',
        'image/gif',
        'application/postscript',
        'application/vnd.ms-word',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    const allowedExtensions = ['.pdf', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.ps', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`File type not allowed: ${file.mimetype}`), false);
    }
};

const upload = multer({ 
    storage, 
    fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

router.use(authenticateToken);

/**
 * POST /api/print/file
 * Upload and print a file
 */
router.post('/file', requireRole(['admin', 'operator']), upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const { printer_id, copies = 1, duplex = false, color = true, paper_size = 'letter' } = req.body;
        
        if (!printer_id) {
            // Clean up file
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Printer ID is required' });
        }
        
        // Get printer info
        const printer = await db.queryOne('SELECT * FROM printers WHERE id = ?', [printer_id]);
        if (!printer) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Printer not found' });
        }
        
        if (!printer.cups_name) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Printer not configured in CUPS' });
        }
        
        // Print the file
        const printResult = await cupsService.printFile(printer.cups_name, req.file.path, {
            copies: parseInt(copies),
            duplex: duplex === 'true' || duplex === true,
            color: color === 'true' || color === true,
            paperSize: paper_size
        });
        
        if (!printResult.success) {
            fs.unlinkSync(req.file.path);
            return res.status(500).json({ error: printResult.error || 'Failed to print' });
        }
        
        // Save to database
        const jobId = await db.insert(`
            INSERT INTO print_jobs (printer_id, user_id, document_name, pages, copies, status, cups_job_id)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)
        `, [printer_id, req.user.id, req.file.originalname, 1, parseInt(copies), printResult.jobId?.split('-').pop()]);
        
        // Log action
        await logAction('print', 'file_upload', {
            printer_id,
            file: req.file.originalname,
            size: req.file.size,
            job_id: jobId
        }, req);
        
        // Schedule file cleanup after 5 minutes
        setTimeout(() => {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
        }, 5 * 60 * 1000);
        
        res.json({
            success: true,
            message: 'Print job submitted successfully',
            job: {
                id: jobId,
                cupsJobId: printResult.jobId,
                documentName: req.file.originalname,
                printer: printer.name
            }
        });
        
    } catch (error) {
        // Clean up file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        logger.error('Print file error:', error);
        next(error);
    }
});

/**
 * POST /api/print/text
 * Print plain text
 */
router.post('/text', requireRole(['admin', 'operator']), async (req, res, next) => {
    try {
        const { printer_id, text, title = 'Text Document', copies = 1 } = req.body;
        
        if (!printer_id || !text) {
            return res.status(400).json({ error: 'Printer ID and text are required' });
        }
        
        const printer = await db.queryOne('SELECT * FROM printers WHERE id = ?', [printer_id]);
        if (!printer || !printer.cups_name) {
            return res.status(404).json({ error: 'Printer not found or not configured' });
        }
        
        const printResult = await cupsService.printText(printer.cups_name, text, title);
        
        if (!printResult.success) {
            return res.status(500).json({ error: printResult.error || 'Failed to print' });
        }
        
        // Save to database
        const jobId = await db.insert(`
            INSERT INTO print_jobs (printer_id, user_id, document_name, pages, copies, status, cups_job_id)
            VALUES (?, ?, ?, 1, ?, 'pending', ?)
        `, [printer_id, req.user.id, title, parseInt(copies), printResult.jobId?.split('-').pop()]);
        
        res.json({
            success: true,
            message: 'Print job submitted',
            job: {
                id: jobId,
                cupsJobId: printResult.jobId
            }
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/print/test
 * Print a test page
 */
router.post('/test', requireRole(['admin', 'operator']), async (req, res, next) => {
    try {
        const { printer_id } = req.body;
        
        if (!printer_id) {
            return res.status(400).json({ error: 'Printer ID is required' });
        }
        
        const printer = await db.queryOne('SELECT * FROM printers WHERE id = ?', [printer_id]);
        if (!printer || !printer.cups_name) {
            return res.status(404).json({ error: 'Printer not found or not configured' });
        }
        
        const printResult = await cupsService.printTestPage(printer.cups_name);
        
        // Log action
        await logAction('print', 'test_page', { printer_id, printer_name: printer.name }, req);
        
        res.json({
            success: printResult.success,
            message: printResult.success ? 'Test page sent to printer' : 'Failed to send test page',
            cupsJobId: printResult.jobId
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/print/queue
 * Get current print queue from CUPS combined with DB info
 */
router.get('/queue', async (req, res, next) => {
    try {
        const { printer } = req.query;
        
        const pendingJobs = await cupsService.getJobs(printer, 'not-completed');
        const completedJobs = await cupsService.getJobs(printer, 'completed');
        
        // Enrich with document names from our database
        const enrichJobs = async (jobs) => {
            const enriched = [];
            for (const job of jobs) {
                const dbJob = await db.queryOne(
                    'SELECT document_name FROM print_jobs WHERE cups_job_id = ?',
                    [job.jobId]
                );
                enriched.push({
                    ...job,
                    name: dbJob?.document_name || job.name || `Document #${job.jobId}`
                });
            }
            return enriched;
        };
        
        res.json({
            pending: await enrichJobs(pendingJobs),
            completed: (await enrichJobs(completedJobs.slice(0, 20)))
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/print/queue/:jobId
 * Cancel a job in CUPS queue
 */
router.delete('/queue/:jobId', requireRole(['admin', 'operator']), async (req, res, next) => {
    try {
        const { jobId } = req.params;
        
        const result = await cupsService.cancelJob(jobId);
        
        if (result.success) {
            await logAction('cancel', 'print_job', { cups_job_id: jobId }, req);
        }
        
        res.json(result);
        
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/print/options
 * Get available print options for a printer
 */
router.get('/options/:printerId', async (req, res, next) => {
    try {
        const printer = await db.queryOne('SELECT * FROM printers WHERE id = ?', [req.params.printerId]);
        
        if (!printer || !printer.cups_name) {
            return res.status(404).json({ error: 'Printer not found' });
        }
        
        // Get printer options from CUPS
        const { execCommand } = require('../utils/shellExec');
        const result = await execCommand(`lpoptions -p "${printer.cups_name}" -l 2>/dev/null`);
        
        const options = [];
        if (result.success && result.stdout) {
            const lines = result.stdout.split('\n');
            for (const line of lines) {
                const match = line.match(/^(\S+)\/([^:]+):\s*(.+)$/);
                if (match) {
                    const [_, name, label, valuesStr] = match;
                    const values = valuesStr.split(/\s+/).map(v => {
                        const isDefault = v.startsWith('*');
                        return {
                            value: v.replace('*', ''),
                            isDefault
                        };
                    });
                    options.push({ name, label, values });
                }
            }
        }
        
        // Standard options that are always available
        const standardOptions = [
            {
                name: 'copies',
                label: 'Copies',
                type: 'number',
                min: 1,
                max: 100,
                default: 1
            },
            {
                name: 'orientation',
                label: 'Orientation',
                values: [
                    { value: 'portrait', isDefault: true },
                    { value: 'landscape', isDefault: false }
                ]
            },
            {
                name: 'sides',
                label: 'Two-Sided',
                values: [
                    { value: 'one-sided', isDefault: true },
                    { value: 'two-sided-long-edge', isDefault: false },
                    { value: 'two-sided-short-edge', isDefault: false }
                ]
            }
        ];
        
        res.json({
            printer: printer.name,
            cupsOptions: options,
            standardOptions
        });
        
    } catch (error) {
        next(error);
    }
});

// ===========================================
// POS Integration Endpoints
// ===========================================

/**
 * POST /api/print/raw
 * Print raw ESC/POS data (for thermal printers from POS systems)
 * 
 * Body can be:
 * - { printer: "name or id", data: "base64 encoded data" }
 * - { printer: "name or id", text: "plain text" }
 * - { ip: "192.168.1.100", data: "base64 encoded data" } (print by IP directly)
 */
router.post('/raw', async (req, res, next) => {
    try {
        const { printer, ip, data, text, cut = true } = req.body;
        
        if (!printer && !ip) {
            return res.status(400).json({ error: 'Printer name/id or IP is required' });
        }
        
        if (!data && !text) {
            return res.status(400).json({ error: 'Data (base64) or text is required' });
        }
        
        let printerRecord = null;
        let cupsName = null;
        
        // Find printer by name, id, or ip
        if (printer) {
            // Try by ID first
            if (!isNaN(printer)) {
                printerRecord = await db.queryOne('SELECT * FROM printers WHERE id = ?', [printer]);
            }
            
            // Try by name
            if (!printerRecord) {
                printerRecord = await db.queryOne('SELECT * FROM printers WHERE name = ? OR cups_name = ?', [printer, printer]);
            }
            
            if (!printerRecord) {
                return res.status(404).json({ error: `Printer "${printer}" not found` });
            }
            
            cupsName = printerRecord.cups_name;
        } else if (ip) {
            // Find by IP
            printerRecord = await db.queryOne('SELECT * FROM printers WHERE ip_address = ?', [ip]);
            if (printerRecord) {
                cupsName = printerRecord.cups_name;
            } else {
                // Print directly to IP without CUPS (raw socket)
                const net = require('net');
                const port = req.body.port || 9100;
                
                let printData;
                if (data) {
                    printData = Buffer.from(data, 'base64');
                } else {
                    // Build ESC/POS from text
                    printData = Buffer.concat([
                        Buffer.from('\x1b\x40'),  // Initialize
                        Buffer.from(text),
                        Buffer.from('\n\n\n'),
                        cut ? Buffer.from('\x1d\x56\x00') : Buffer.from('')  // Cut
                    ]);
                }
                
                return new Promise((resolve, reject) => {
                    const socket = new net.Socket();
                    socket.setTimeout(10000);
                    
                    socket.connect(port, ip, () => {
                        socket.write(printData, () => {
                            socket.end();
                            res.json({ 
                                success: true, 
                                message: 'Print job sent directly to printer',
                                ip,
                                port,
                                bytes: printData.length
                            });
                            resolve();
                        });
                    });
                    
                    socket.on('error', (err) => {
                        res.status(500).json({ error: `Failed to connect to printer: ${err.message}` });
                        resolve();
                    });
                    
                    socket.on('timeout', () => {
                        socket.destroy();
                        res.status(500).json({ error: 'Connection timeout' });
                        resolve();
                    });
                });
            }
        }
        
        // Print via CUPS
        if (cupsName) {
            const fs = require('fs');
            const tmpFile = `/tmp/pos_print_${Date.now()}.bin`;
            
            let printData;
            if (data) {
                printData = Buffer.from(data, 'base64');
            } else {
                // Build ESC/POS from text
                printData = Buffer.concat([
                    Buffer.from('\x1b\x40'),  // Initialize
                    Buffer.from(text),
                    Buffer.from('\n\n\n'),
                    cut ? Buffer.from('\x1d\x56\x00') : Buffer.from('')  // Cut
                ]);
            }
            
            fs.writeFileSync(tmpFile, printData);
            
            const { execCupsCommand } = require('../utils/shellExec');
            const result = await execCupsCommand(`lp -d "${cupsName}" -o raw "${tmpFile}"`);
            
            fs.unlinkSync(tmpFile);
            
            if (result.success) {
                const match = result.stdout.match(/request id is (\S+)/);
                const jobId = match ? match[1] : null;
                
                // Log the print job
                if (printerRecord) {
                    await db.insert(`
                        INSERT INTO print_jobs (printer_id, user_id, document_name, status, pages)
                        VALUES (?, ?, 'POS Print', 'completed', 1)
                    `, [printerRecord.id, req.user?.id || null]);
                }
                
                return res.json({ 
                    success: true, 
                    message: 'Print job sent',
                    jobId,
                    printer: printerRecord?.name,
                    cups_name: cupsName
                });
            } else {
                return res.status(500).json({ error: result.stderr || 'Print failed' });
            }
        }
        
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/print/receipt
 * Simplified receipt printing for POS
 * Automatically formats text with ESC/POS commands
 */
router.post('/receipt', async (req, res, next) => {
    try {
        const { 
            printer,
            lines = [],
            header = null,
            footer = null,
            cut = true,
            feedLines = 5
        } = req.body;
        
        if (!printer) {
            return res.status(400).json({ error: 'Printer name or id is required' });
        }
        
        // Find printer
        let printerRecord = null;
        if (!isNaN(printer)) {
            printerRecord = await db.queryOne('SELECT * FROM printers WHERE id = ?', [printer]);
        }
        if (!printerRecord) {
            printerRecord = await db.queryOne('SELECT * FROM printers WHERE name = ? OR cups_name = ?', [printer, printer]);
        }
        if (!printerRecord) {
            return res.status(404).json({ error: `Printer "${printer}" not found` });
        }
        
        // Build ESC/POS receipt
        const parts = [
            Buffer.from('\x1b\x40'),  // Initialize
        ];
        
        // Header (centered, bold)
        if (header) {
            parts.push(Buffer.from('\x1b\x61\x01'));  // Center
            parts.push(Buffer.from('\x1b\x45\x01'));  // Bold on
            parts.push(Buffer.from(header + '\n'));
            parts.push(Buffer.from('\x1b\x45\x00'));  // Bold off
            parts.push(Buffer.from('================================\n'));
            parts.push(Buffer.from('\x1b\x61\x00'));  // Left align
        }
        
        // Lines
        for (const line of lines) {
            if (typeof line === 'string') {
                parts.push(Buffer.from(line + '\n'));
            } else if (typeof line === 'object') {
                // { text: "...", align: "center"|"left"|"right", bold: true/false }
                if (line.align === 'center') parts.push(Buffer.from('\x1b\x61\x01'));
                else if (line.align === 'right') parts.push(Buffer.from('\x1b\x61\x02'));
                else parts.push(Buffer.from('\x1b\x61\x00'));
                
                if (line.bold) parts.push(Buffer.from('\x1b\x45\x01'));
                parts.push(Buffer.from((line.text || '') + '\n'));
                if (line.bold) parts.push(Buffer.from('\x1b\x45\x00'));
            }
        }
        
        // Footer (centered)
        if (footer) {
            parts.push(Buffer.from('\n'));
            parts.push(Buffer.from('--------------------------------\n'));
            parts.push(Buffer.from('\x1b\x61\x01'));  // Center
            parts.push(Buffer.from(footer + '\n'));
        }
        
        // Feed and cut
        parts.push(Buffer.from('\n'.repeat(feedLines)));
        if (cut) {
            parts.push(Buffer.from('\x1d\x56\x00'));  // Full cut
        }
        
        const printData = Buffer.concat(parts);
        
        // Send to printer
        const fs = require('fs');
        const tmpFile = `/tmp/receipt_${Date.now()}.bin`;
        fs.writeFileSync(tmpFile, printData);
        
        const { execCupsCommand } = require('../utils/shellExec');
        const result = await execCupsCommand(`lp -d "${printerRecord.cups_name}" -o raw "${tmpFile}"`);
        
        fs.unlinkSync(tmpFile);
        
        if (result.success) {
            const match = result.stdout.match(/request id is (\S+)/);
            
            await db.insert(`
                INSERT INTO print_jobs (printer_id, user_id, document_name, status, pages)
                VALUES (?, ?, 'Receipt', 'completed', 1)
            `, [printerRecord.id, req.user?.id || null]);
            
            return res.json({ 
                success: true, 
                message: 'Receipt printed',
                jobId: match ? match[1] : null,
                printer: printerRecord.name
            });
        } else {
            return res.status(500).json({ error: result.stderr || 'Print failed' });
        }
        
    } catch (error) {
        next(error);
    }
});

module.exports = router;
