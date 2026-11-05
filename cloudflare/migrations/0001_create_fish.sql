CREATE TABLE IF NOT EXISTS fish (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  introduction TEXT NOT NULL DEFAULT '',
  fish_data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS fish_created_at_idx ON fish(created_at DESC);
CREATE INDEX IF NOT EXISTS fish_name_idx ON fish(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS fish_owner_idx ON fish(owner COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS admin_attempts (
  ip_hash TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submission_attempts (
  ip_hash TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
