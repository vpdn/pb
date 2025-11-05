-- Migration: Add last_accessed_at column to uploads table
ALTER TABLE uploads ADD COLUMN last_accessed_at DATETIME DEFAULT NULL;
