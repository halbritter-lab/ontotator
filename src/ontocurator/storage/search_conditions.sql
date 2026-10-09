CREATE TABLE IF NOT EXISTS package_search_conditions (
    package_id TEXT PRIMARY KEY REFERENCES packages(package_id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL
);
