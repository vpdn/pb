-- Migration: Add access_count column to uploads table
ALTER TABLE uploads ADD COLUMN access_count INTEGER DEFAULT 0;
