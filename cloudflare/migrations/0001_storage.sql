CREATE TABLE IF NOT EXISTS workspace_documents (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  version TEXT NOT NULL,
  chunks INTEGER NOT NULL CHECK (chunks > 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_chunks (
  document_id TEXT NOT NULL,
  version TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (document_id, version, chunk_index)
);
CREATE TABLE IF NOT EXISTS request_rate_limits (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);
CREATE INDEX IF NOT EXISTS request_rate_limits_expiry ON request_rate_limits (expires);
