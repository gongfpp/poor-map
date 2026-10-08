CREATE TABLE IF NOT EXISTS offers (scope TEXT NOT NULL DEFAULT 'public', id TEXT NOT NULL, record TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope,id));
CREATE TABLE IF NOT EXISTS revisions (seq INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, offer_id TEXT NOT NULL, before_record TEXT, after_record TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS revisions_offer ON revisions(scope,offer_id,seq);
CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, scope TEXT NOT NULL, offer_id TEXT NOT NULL, type TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS feedback_offer ON feedback(scope,offer_id,created_at);
CREATE TABLE IF NOT EXISTS rate_limits (ip_hash TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(ip_hash,bucket));
CREATE TABLE IF NOT EXISTS comments (scope TEXT NOT NULL, id TEXT NOT NULL, store_id TEXT NOT NULL, parent_id TEXT, root_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(scope,id));
CREATE INDEX IF NOT EXISTS comments_store ON comments(scope,store_id,created_at);
CREATE TABLE IF NOT EXISTS analytics_events (scope TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT NOT NULL, page TEXT NOT NULL, name TEXT NOT NULL, properties TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(scope,id));
CREATE INDEX IF NOT EXISTS analytics_time ON analytics_events(scope,created_at);

CREATE TABLE IF NOT EXISTS stores (scope TEXT NOT NULL,id TEXT NOT NULL,record TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(scope,id));

CREATE TABLE IF NOT EXISTS cached_pois (scope TEXT NOT NULL,provider TEXT NOT NULL,id TEXT NOT NULL,city TEXT NOT NULL DEFAULT '',category TEXT NOT NULL,lng REAL NOT NULL,lat REAL NOT NULL,record TEXT NOT NULL,fetched_at TEXT NOT NULL,PRIMARY KEY(scope,provider,id));
CREATE INDEX IF NOT EXISTS cached_pois_geo ON cached_pois(scope,category,lng,lat);
CREATE TABLE IF NOT EXISTS cache_runs (scope TEXT NOT NULL,run_key TEXT NOT NULL,provider TEXT NOT NULL,city TEXT NOT NULL DEFAULT '',record TEXT NOT NULL,fetched_at TEXT NOT NULL,PRIMARY KEY(scope,run_key));
