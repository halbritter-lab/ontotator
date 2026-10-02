CREATE TABLE IF NOT EXISTS package_ontology_resources (
    package_id TEXT NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    resource_path TEXT NOT NULL,
    content BLOB NOT NULL,
    PRIMARY KEY (package_id, resource_path)
);
