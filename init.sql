-- ===========================================
-- Printer Management System - Database Schema
-- ===========================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- ===========================================
-- Users Table
-- ===========================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'operator', 'viewer') NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN DEFAULT TRUE,
    last_login DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================
-- Printers Table
-- ===========================================
CREATE TABLE IF NOT EXISTS printers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    dns_name VARCHAR(255) NULL,
    port INT DEFAULT 9100,
    protocol ENUM('socket', 'ipp', 'ipps', 'http', 'lpd') DEFAULT 'ipp',
    printer_type ENUM('network', 'thermal', 'unknown') DEFAULT 'network',
    cups_name VARCHAR(100) UNIQUE,
    manufacturer VARCHAR(100) NULL,
    model VARCHAR(100) NULL,
    location VARCHAR(255) NULL,
    description TEXT NULL,
    tags VARCHAR(500) NULL COMMENT 'Comma-separated tags for filtering',
    status ENUM('online', 'offline', 'error', 'printing', 'paused', 'unknown') DEFAULT 'unknown',
    is_default BOOLEAN DEFAULT FALSE,
    paper_status ENUM('ok', 'low', 'empty', 'unknown') DEFAULT 'unknown',
    toner_level INT DEFAULT -1 COMMENT '-1 means unknown, 0-100 percentage',
    snmp_enabled BOOLEAN DEFAULT TRUE,
    error_message VARCHAR(500) NULL,
    page_count INT DEFAULT 0,
    last_check DATETIME NULL,
    last_status_check DATETIME NULL,
    in_maintenance BOOLEAN DEFAULT FALSE COMMENT 'Individual maintenance mode',
    maintenance_note VARCHAR(255) NULL COMMENT 'Reason for maintenance',
    maintenance_until DATETIME NULL COMMENT 'Optional end time',
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ip (ip_address),
    INDEX idx_status (status),
    INDEX idx_cups_name (cups_name),
    INDEX idx_location (location),
    INDEX idx_printer_type (printer_type),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================
-- Print Jobs Table
-- ===========================================
CREATE TABLE IF NOT EXISTS print_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    printer_id INT NOT NULL,
    user_id INT NULL,
    cups_job_id INT NULL,
    document_name VARCHAR(255) NULL,
    pages INT DEFAULT 0,
    copies INT DEFAULT 1,
    status ENUM('pending', 'processing', 'printing', 'completed', 'cancelled', 'error') DEFAULT 'pending',
    error_message TEXT NULL,
    size_kb INT DEFAULT 0,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_printer (printer_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_submitted (submitted_at),
    INDEX idx_cups_job (cups_job_id),
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================
-- Notification Configs Table
-- ===========================================
CREATE TABLE IF NOT EXISTS notification_configs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    printer_id INT NULL COMMENT 'NULL means all printers',
    event_type ENUM('printer_offline', 'printer_online', 'paper_low', 'toner_low', 'print_error', 'printer_added', 'printer_removed') NOT NULL,
    notification_method ENUM('email', 'webhook', 'in_app') NOT NULL,
    destination VARCHAR(500) NULL COMMENT 'Email address or webhook URL',
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_printer (printer_id),
    INDEX idx_event (event_type),
    INDEX idx_enabled (is_enabled),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================
-- In-App Notifications Table
-- ===========================================
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    printer_id INT NULL,
    event_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_read (is_read),
    INDEX idx_created (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================
-- System Logs Table (Audit)
-- ===========================================
CREATE TABLE IF NOT EXISTS system_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    level ENUM('debug', 'info', 'warning', 'error', 'critical') NOT NULL DEFAULT 'info',
    category ENUM('auth', 'printer', 'job', 'system', 'notification', 'api') NOT NULL,
    message VARCHAR(500) NOT NULL,
    details JSON NULL,
    user_id INT NULL,
    printer_id INT NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_level (level),
    INDEX idx_category (category),
    INDEX idx_user (user_id),
    INDEX idx_printer (printer_id),
    INDEX idx_created (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================
-- Refresh Tokens Table
-- ===========================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(500) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_token (token(255)),
    INDEX idx_user (user_id),
    INDEX idx_expires (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================
-- Printer Stats Daily (Aggregated)
-- ===========================================
CREATE TABLE IF NOT EXISTS printer_stats_daily (
    id INT AUTO_INCREMENT PRIMARY KEY,
    printer_id INT NOT NULL,
    date DATE NOT NULL,
    total_jobs INT DEFAULT 0,
    successful_jobs INT DEFAULT 0,
    failed_jobs INT DEFAULT 0,
    cancelled_jobs INT DEFAULT 0,
    total_pages INT DEFAULT 0,
    total_copies INT DEFAULT 0,
    downtime_minutes INT DEFAULT 0,
    avg_job_duration_seconds INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_printer_date (printer_id, date),
    INDEX idx_printer (printer_id),
    INDEX idx_date (date),
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================
-- Settings Table (Key-Value)
-- ===========================================
CREATE TABLE IF NOT EXISTS settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT NULL,
    description VARCHAR(255) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================
-- Insert Default Admin User
-- Password: Admin123! (bcrypt hash)
-- ===========================================
INSERT INTO users (email, password, name, role, is_active) VALUES 
('admin@printer.local', '$2b$10$GMxlXLcQOrod83fNFcsDN.uyOMWNCTFEIlgx36CbyJ4GMS5ArwmTu', 'Administrator', 'admin', TRUE)
ON DUPLICATE KEY UPDATE name = 'Administrator';

-- ===========================================
-- Maintenance Schedule Table (Active Hours)
-- ===========================================
CREATE TABLE IF NOT EXISTS maintenance_schedule (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL DEFAULT 'Default Schedule',
    description TEXT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    -- Days of week (0=Sunday, 1=Monday, etc.)
    monday BOOLEAN DEFAULT TRUE,
    tuesday BOOLEAN DEFAULT TRUE,
    wednesday BOOLEAN DEFAULT TRUE,
    thursday BOOLEAN DEFAULT TRUE,
    friday BOOLEAN DEFAULT TRUE,
    saturday BOOLEAN DEFAULT FALSE,
    sunday BOOLEAN DEFAULT FALSE,
    -- Active hours (when monitoring is ON)
    start_time TIME DEFAULT '06:00:00',
    end_time TIME DEFAULT '20:00:00',
    -- Timezone
    timezone VARCHAR(50) DEFAULT 'America/Bogota',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default schedule (Monday-Friday 6AM-8PM)
INSERT INTO maintenance_schedule (name, description, is_active, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_time, end_time)
VALUES ('Default Office Hours', 'Monitor printers during business hours only', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, '06:00:00', '20:00:00')
ON DUPLICATE KEY UPDATE name = name;

-- ===========================================
-- Insert Default Settings
-- ===========================================
INSERT INTO settings (setting_key, setting_value, description) VALUES
('monitor_interval_seconds', '120', 'Printer status check interval in seconds'),
('auto_discovery_enabled', 'true', 'Enable automatic printer discovery via Avahi'),
('default_printer_protocol', 'ipp', 'Default protocol for new printers (ipp, socket, lpd)'),
('default_printer_port', '631', 'Default port for IPP printers'),
('notification_email_enabled', 'false', 'Enable email notifications'),
('notification_webhook_enabled', 'false', 'Enable webhook notifications'),
('log_retention_days', '90', 'Days to keep system logs'),
('stats_retention_days', '365', 'Days to keep daily statistics')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- ===========================================
-- Create Views for Reports
-- ===========================================
CREATE OR REPLACE VIEW v_printer_summary AS
SELECT 
    p.id,
    p.name,
    p.ip_address,
    p.status,
    p.location,
    p.last_check,
    COUNT(DISTINCT pj.id) as total_jobs,
    SUM(CASE WHEN pj.status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
    SUM(CASE WHEN pj.status = 'error' THEN 1 ELSE 0 END) as failed_jobs,
    SUM(COALESCE(pj.pages, 0)) as total_pages
FROM printers p
LEFT JOIN print_jobs pj ON p.id = pj.printer_id
GROUP BY p.id;

CREATE OR REPLACE VIEW v_daily_stats AS
SELECT 
    DATE(pj.submitted_at) as date,
    COUNT(*) as total_jobs,
    SUM(CASE WHEN pj.status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN pj.status = 'error' THEN 1 ELSE 0 END) as errors,
    SUM(COALESCE(pj.pages, 0)) as pages
FROM print_jobs pj
WHERE pj.submitted_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY DATE(pj.submitted_at)
ORDER BY date DESC;
