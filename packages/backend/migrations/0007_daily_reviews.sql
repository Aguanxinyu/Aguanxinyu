CREATE TABLE daily_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  review_date TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  stats JSONB NOT NULL,
  summary TEXT NOT NULL,
  highlights JSONB NOT NULL,
  blockers JSONB NOT NULL,
  tomorrow_suggestions JSONB NOT NULL,
  facts_hash TEXT NOT NULL,
  model TEXT,
  generation_count INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (user_id, review_date)
);

CREATE INDEX daily_reviews_user_date_idx
  ON daily_reviews (user_id, review_date);
