-- Multi-channel WeChat identity: miniprogram + website app linked by unionid.
ALTER TABLE users ADD COLUMN IF NOT EXISTS union_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mp_open_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS web_open_id TEXT;

UPDATE users
SET mp_open_id = open_id
WHERE mp_open_id IS NULL AND open_id IS NOT NULL;

ALTER TABLE users ALTER COLUMN open_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_union_id_uidx ON users (union_id) WHERE union_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_mp_open_id_uidx ON users (mp_open_id) WHERE mp_open_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_web_open_id_uidx ON users (web_open_id) WHERE web_open_id IS NOT NULL;

-- Keep open_id as a mirror of mp_open_id for one release; new code writes both.
UPDATE users SET open_id = mp_open_id WHERE mp_open_id IS NOT NULL;
