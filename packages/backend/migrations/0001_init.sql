-- Initial schema: today-todo self-hosted PostgreSQL.

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  open_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  deletion_requested_at BIGINT,
  purge_after_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE tasks (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  due_at BIGINT,
  due_has_time BOOLEAN NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  original_status TEXT,
  list_id TEXT NOT NULL,
  tag_ids JSONB NOT NULL,
  location JSONB,
  series_id TEXT,
  occurrence_date TEXT,
  remind_at BIGINT,
  version INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT,
  trashed_at BIGINT,
  purge_after_at BIGINT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX tasks_user_status_due_idx ON tasks (user_id, status, due_at);

CREATE TABLE series (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL,
  start_date TEXT NOT NULL,
  rule JSONB NOT NULL,
  template JSONB NOT NULL,
  materialized_through TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE lists (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_inbox BOOLEAN NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE tags (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_version INTEGER NOT NULL,
  fire_at BIGINT NOT NULL,
  state TEXT NOT NULL,
  title TEXT NOT NULL
);
CREATE INDEX reminders_fire_state_idx ON reminders (fire_at, state);

CREATE TABLE reminder_grants (
  user_id TEXT PRIMARY KEY,
  available INTEGER NOT NULL
);

CREATE TABLE idempotency (
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  result JSONB NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, scope)
);
