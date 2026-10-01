CREATE TABLE package_axes_profiles (
  package_id TEXT PRIMARY KEY REFERENCES packages(package_id) ON DELETE CASCADE,
  profile_json TEXT NOT NULL,
  profile_sha256 TEXT NOT NULL
);
