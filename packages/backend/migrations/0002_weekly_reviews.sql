-- Weekly review AI MVP storage.

CREATE TABLE weekly_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  stats JSONB NOT NULL,
  summary TEXT NOT NULL,
  improvements JSONB NOT NULL,
  highlights JSONB NOT NULL,
  model TEXT,
  error_code TEXT,
  generation_count INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (user_id, week_start)
);
CREATE INDEX weekly_reviews_user_idx ON weekly_reviews (user_id);
