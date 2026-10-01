CREATE TABLE package_annotations (
 package_id TEXT NOT NULL REFERENCES packages(package_id),
 annotation_id TEXT NOT NULL, version TEXT NOT NULL,
 PRIMARY KEY(package_id, annotation_id, version)
);
CREATE TABLE package_evidence (
 package_id TEXT NOT NULL REFERENCES packages(package_id),
 evidence_id TEXT NOT NULL, version TEXT NOT NULL,
 PRIMARY KEY(package_id, evidence_id, version)
);
CREATE TABLE migration_warnings (message TEXT NOT NULL);
INSERT INTO package_annotations
SELECT d.package_id, a.annotation_id, a.version FROM annotation_snapshots a
JOIN documents d USING(document_id)
WHERE (SELECT count(*) FROM documents dd WHERE dd.document_id = a.document_id) = 1
AND NOT EXISTS (SELECT 1 FROM workspace_annotations w WHERE w.annotation_id=a.annotation_id AND w.version=a.version);
INSERT INTO package_evidence
SELECT d.package_id, e.evidence_id, e.version FROM evidence_snapshots e
JOIN documents d USING(document_id)
WHERE (SELECT count(*) FROM documents dd WHERE dd.document_id = e.document_id) = 1
AND NOT EXISTS (SELECT 1 FROM workspace_evidence w WHERE w.evidence_id=e.evidence_id AND w.version=e.version);
INSERT INTO migration_warnings
SELECT 'Legacy snapshot membership is ambiguous. Snapshots are preserved; reimport original packages to restore explicit membership.'
WHERE EXISTS (SELECT 1 FROM annotation_snapshots a WHERE NOT EXISTS (SELECT 1 FROM package_annotations p WHERE p.annotation_id=a.annotation_id AND p.version=a.version))
OR EXISTS (SELECT 1 FROM evidence_snapshots e WHERE NOT EXISTS (SELECT 1 FROM package_evidence p WHERE p.evidence_id=e.evidence_id AND p.version=e.version));
CREATE TABLE package_search_events (
 package_id TEXT NOT NULL REFERENCES packages(package_id),
 event_id TEXT NOT NULL REFERENCES search_events(event_id),
 local_key TEXT NOT NULL,
 PRIMARY KEY(package_id, event_id)
);
INSERT INTO package_search_events
SELECT p.package_id, e.event_id, e.workspace_key FROM search_events e
JOIN packages p ON json_extract(e.payload_json, '$.workspace_key.package_id')=p.package_id;
