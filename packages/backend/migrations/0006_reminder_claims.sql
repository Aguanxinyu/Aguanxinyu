ALTER TABLE reminders
  ADD COLUMN claimed_at BIGINT;

CREATE INDEX reminders_sending_claimed_idx
  ON reminders (claimed_at)
  WHERE state = 'SENDING';
