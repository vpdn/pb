-- Add expires_at column to uploads table for file expiration support
ALTER TABLE uploads ADD COLUMN expires_at DATETIME DEFAULT NULL;

-- Create index for efficient expiration queries
CREATE INDEX idx_expires_at ON uploads(expires_at) WHERE expires_at IS NOT NULL;