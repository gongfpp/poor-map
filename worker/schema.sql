CREATE TABLE IF NOT EXISTS offers (scope TEXT NOT NULL DEFAULT 'public', id TEXT NOT NULL, record TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope,id));
CREATE TABLE IF NOT EXISTS revisions (seq INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, offer_id TEXT NOT NULL, before_record TEXT, after_record TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS revisions_offer ON revisions(scope,offer_id,seq);
CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, scope TEXT NOT NULL, offer_id TEXT NOT NULL, type TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS feedback_offer ON feedback(scope,offer_id,created_at);
CREATE TABLE IF NOT EXISTS rate_limits (ip_hash TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(ip_hash,bucket));
