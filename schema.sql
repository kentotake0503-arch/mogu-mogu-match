CREATE TABLE IF NOT EXISTS users (
  code TEXT PRIMARY KEY,
  auth_method TEXT NOT NULL DEFAULT 'code',
  nickname TEXT NOT NULL DEFAULT '',
  current_result_json TEXT,
  diagnosis_history_json TEXT NOT NULL DEFAULT '[]',
  friend_matches_json TEXT NOT NULL DEFAULT '[]',
  group_logs_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_logs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  organizer_user_code TEXT,
  members_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_logs_updated_at ON group_logs(updated_at);
CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at);
