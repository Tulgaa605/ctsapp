CREATE DATABASE IF NOT EXISTS cts_app
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE cts_app;

CREATE TABLE IF NOT EXISTS scan_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lord_id VARCHAR(255) DEFAULT '',
  account VARCHAR(255) DEFAULT '',
  asset_code VARCHAR(255) NOT NULL,
  unit_price VARCHAR(64) DEFAULT '',
  date_str VARCHAR(64) DEFAULT '',
  serial_number VARCHAR(255) NOT NULL,
  org_code VARCHAR(255) DEFAULT '',
  raw_data TEXT NOT NULL,
  handler VARCHAR(255) DEFAULT '',
  asset_name VARCHAR(512) DEFAULT '',
  unit_type VARCHAR(128) DEFAULT '',
  device_id VARCHAR(255) DEFAULT '',
  year INT NOT NULL,
  month INT NOT NULL,
  tag VARCHAR(64) DEFAULT 'CT$FS4',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_asset_serial (asset_code, serial_number),
  INDEX idx_year_month (year, month),
  INDEX idx_created_at (created_at)
);
