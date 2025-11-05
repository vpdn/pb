CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used DATETIME,
  is_active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT UNIQUE NOT NULL,
  group_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  relative_path TEXT,
  size INTEGER NOT NULL,
  content_type TEXT,
  api_key_id INTEGER NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at DATETIME DEFAULT NULL,
  access_count INTEGER DEFAULT 0,
  expires_at DATETIME DEFAULT NULL,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

CREATE INDEX idx_file_id ON uploads(file_id);
CREATE INDEX idx_group_id ON uploads(group_id);
CREATE INDEX idx_api_key ON api_keys(key);
