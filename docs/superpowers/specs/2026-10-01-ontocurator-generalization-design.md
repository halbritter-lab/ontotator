# Design: Generalisierung und Umbenennung zu Ontocurator

**Datum:** 2026-10-01; überarbeitet 2026-10-02 nach Quellcodeprüfung.
**Status:** Überarbeiteter Entwurf; Implementierung nicht begonnen.
**Plan:** [Implementation Plan](../plans/2026-10-01-ontocurator-generalization.md).

## 1. Ziel und Umfang

Der lokale Annotations- und Revieweditor wird zu `ontocurator` generalisiert. Python-Distribution, Namensraum und CLI heißen `ontocurator`; öffentliche Modelle verwenden `term_id`. Die bestehende Architektur mit unveränderlichen Eingaben, Textspannen, Provenienz, Review und lokalem Betrieb bleibt erhalten.

Unterstützt werden geladene OBO-Graph-JSON-Ontologien, etwa HPO und MONDO, innerhalb der unten definierten Identifier-Syntax. Pro Server und Paket bleibt eine gepinnte Ontologie maßgeblich. Es gibt keine automatische Ontologiebeschaffung oder Behauptung vollständiger Unterstützung sämtlicher OBO-/OWL-Konstrukte.

Der aktuelle Checkout-Pfad bleibt bestehen. Eine Umbenennung des Remote-Repositories oder Veröffentlichung gehört nicht zu diesem Auftrag. Node.js bleibt Build-Werkzeug; Anwender starten einen lokalen Python-Dienst mit eingebetteter Oberfläche.

## 2. Namensraum und öffentliche Verträge

`src/hpo_editor` wird nach `src/ontocurator` verschoben. CLI: `ontocurator = "ontocurator.cli:main"`. Packaging, Hatch-/mypy-Konfiguration, Lockfiles, Tests, CI, OpenAPI-Export und Release-Skript werden vollständig angepasst.

Öffentliche Annotationen, Bearbeitungskommandos, Suchkandidaten und Termstatus verwenden `term_id`. Alte Eingaben mit `hpo_id` werden weiterhin akzeptiert; widersprüchliche Aliaswerte werden zurückgewiesen. Ein alter Python-Namensraum oder CLI-Alias wird nicht zugesichert. Historische Suchereignisse behalten `selected_hpo_id`; neue Ereignisse verwenden `selected_term_id`.

Unterstützte CURIE-Syntax: `^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$`. Indexmitgliedschaft entscheidet, ob ein syntaktisch gültiger Term bekannt ist. Unbekannte und obsolete Eingaben bleiben sichtbar; bisherige Reviewregeln gelten weiter.

## 3. Historische Identität und versionierte Serialisierung

Die Umbenennung eines Feldes darf keine historischen Hashes verändern. Dazu werden immutable Paket-/Speicherdarstellungen von normalisierten Anwendungs- und API-Ansichten getrennt.

- Snapshots ohne `schema_version` sind Legacy-Datensätze. Ihre validierte Darstellung einschließlich `hpo_id`, alter Achsenfelder, expliziter Nullwerte und `editor-axes/v1` bleibt erhalten. Hashprüfung verwendet unverändert den alten Algorithmus.
- Neue Snapshots erhalten `schema_version: "ontocurator-annotation/v2"`, `axes_config_sha256` und Annotationen mit `term_id` sowie `{definition_name, values}`. Der kanonische Hash bindet die beiden neuen Felder und die bisherigen Inhalte `annotation`, `document_id`, sortierte `evidence`, `ontology_sha256`, `text_sha256`; das Feld `version` bleibt ausgeschlossen.
- Neue Bearbeitung eines alten Snapshots erzeugt eine neue Version mit bestehenden Copy-on-write-Regeln. Lesen, Anzeigen und Export allein erzeugen keine neue Version.
- Historische Zielmengen, Entscheidungen, Abgaben, Ursprungsmanifeste und Receipt-Requesthashes werden nicht umgeschrieben. Unbekannte Snapshotversionen werden abgewiesen.
- API-Ansichten zeigen normalisierte Felder, ursprüngliche Identität und eine Schemabezeichnung (`legacy/v1` bei alten Snapshots). Sie sind keine Archivdatensätze und werden im Browser nicht erneut gehasht. Export verwendet die ursprünglichen versionierten Wire-Daten.

Ein zentraler Codec wird bei allen Speicher-/Paketpfaden genutzt, einschließlich eingebetteter Snapshots in Abgaben und Receipt-Antworten sowie Kollisionsvergleichen. Zusätzliche optionale Felder dürfen auch die kanonische Identität alter Manifeste nicht verändern.

Receiptprüfung erfolgt anhand des ursprünglichen Request-Envelopes vor Aliasnormalisierung. Ein Retry liefert dieselbe fachliche Antwort als aktuelle API-Ansicht ohne erneute Mutation. Dieselbe Mutation-ID mit anders kodiertem Request bleibt ein Konflikt.

## 4. Dynamische Kontextachsen

Verbindliche Modelle:

```text
AxisDefinition(id: str, label: str, options: list[str], allow_empty: bool = True)
AxesConfig(definition_name: str, axes: list[AxisDefinition])
Axes(definition_name: str, values: dict[str, str | None])
```

Die getrennten eingebauten Profilnamen `editor-axes/v1` und `clinical-phenotype/v1` haben dieselben Achsen: assertion `present|absent|uncertain`, experiencer `patient|other`, temporality `current|historical|future`. Historische Namen werden nicht normalisiert. Eigene Profile und eine explizite leere Achsenliste sind möglich.

Servervalidierung lehnt unbekannte Achsen, ungültige Werte, Profilabweichungen, doppelte/leere Achsen-IDs und doppelte/leere Optionen ab. Fehlend oder `null` bedeutet unbekannt, nicht leere Zeichenkette. Entwürfe dürfen unvollständige Pflichtachsen haben; Bestätigen, Ersatzfreigabe und Abgabe verlangen Werte bei `allow_empty=False`. Verwerfen oder Unsicher-Markieren erfordert kein Vervollständigen der Eingabe. Klinische Standardachsen erlauben unbekannte Werte.

Neue Snapshots ergänzen fehlende konfigurierte Werte zu `null`; historische Wire-Daten behalten ihre ursprünglichen Null-/Abwesenheitsunterschiede. Profilhashes binden Namen, Labels, geordnete Achsen/Optionen und Pflichtregeln. Bestehende unveränderliche Snapshots erhalten keine mutierenden Convenience-Setter.

### Auflösung und CLI

Manifest: `axes_definition`, optional `axes_config: list[AxisDefinition] | None`; neue Exporte enthalten zusätzlich `axes_config_sha256`. V2-Snapshots müssen zum Profilhash passen. Alte Snapshots dürfen nicht unter einem eigenen Profil neu interpretiert werden.

Auflösung: explizite Manifestkonfiguration einschließlich `[]`, sonst bekanntes eingebautes Profil, sonst passender CLI-Fallback, sonst verständlicher Fehler. Eingebaute Profile dürfen nicht unter demselben Namen anders definiert werden.

`ontocurator serve --axes-config PATH` liest ein JSON-Objekt `AxesConfig`. Es dient nur als Fallback für ein unbekanntes Profil ohne Manifestkonfiguration und überschreibt keine expliziten oder eingebauten Profile. Fehlerhafte Dateien verhindern den Start.

Das aufgelöste Profil wird paketgebunden außerhalb des ursprünglichen Manifests persistiert. Neustarts benötigen die CLI-Datei nicht erneut. Widersprüchliche Auflösung für ein vorhandenes Paket wird abgewiesen. Workspace-Exporte enthalten die vollständige Konfiguration samt Profilhash.

## 5. SQLite und Paketaustausch

Tatsächliches Schema: Annotationen liegen als `payload_json` in `annotation_snapshots`. Es existiert keine SQL-Spalte `annotations.hpo_id`, die umzubenennen wäre.

Schema v3 ergänzt `package_axes_profiles(package_id PRIMARY KEY REFERENCES packages(package_id), profile_json NOT NULL, profile_sha256 NOT NULL)`. Bestehende eingebaute Profile werden transaktional ergänzt; unbekannte nicht auflösbare Profile führen zum Rollback. Historische Annotationen, Abgaben und Receipts bleiben unverändert. Schema-Markierung erst nach erfolgreicher Migration; frische DBs, v1/v2-Upgrades, Wiederholung nach Fehler und Neustart sind Testfälle.

Import akzeptiert `hpo-editor-work-package/v1` sowie `ontocurator-work-package/v1`. Export schreibt das neue Format und darf alte und neue Snapshots gemeinsam enthalten. Legacy-formatierte Archive dürfen keine v2-Snapshots enthalten. Datei-Hashes werden vor dem Dekodieren geprüft, Snapshot-Hashes anschließend nach ihrer jeweiligen Version. Referenzauflösung und Profilbindung bleiben verpflichtend.

Ein Workspace-Export erhält eine neue Paketidentität und neue äußere Dateihashes, bewahrt historische Inhalte und den echten Quellmanifesthash und übernimmt das aufgelöste Achsenprofil. Independent-Exporte bleiben auf eigene Inhalte beschränkt.

## 6. Ontologie und Suche

Der vorhandene Parser wird um unterstützte explizite CURIEs und OBO-IRI-Endungen mit entsprechenden Präfix-/lokalen ID-Zeichen erweitert. Explizite IDs behalten Schreibweise und Groß-/Kleinschreibung. Nicht unterstützte externe IRIs werden nicht in erfundene CURIEs umgewandelt.

Das dominante Präfix wird anhand der Anzahl geladener Terme ermittelt. Numerische Suche findet innerhalb eines eindeutig dominanten Präfixes numerisch gleichwertige lokale IDs: `1250` kann so `MONDO:0001250` finden, ohne feste Stellenzahl. Bei Präfixgleichstand oder mehreren passenden IDs gibt es keinen geratenen ID-Treffer; die Oberfläche verweist auf die vollständige CURIE. Explizite CURIEs funktionieren für jedes geladene Präfix. Label-/Synonym-/lexikalische Suche bleibt verfügbar.

Die Normalisierungsregel erhält eine Version in der Suchindexidentität. Historische Suchereignisse bleiben unverändert; Vendoränderungen und Attribution werden dokumentiert.

## 7. Oberfläche und Auslieferung

Header: `Ontocurator`; Untertitel: `Lokale Ontologie-Annotation und Review`. Termbeschriftungen sind ontologie-neutral. Workspace-Antworten enthalten Profilname, Profilhash und Achsendefinitionen; die Oberfläche rendert daraus Selects, erhält unbekannte Werte und blendet den Bereich für `[]` aus. Pflichtstatus und Servervalidierungsfehler sind sichtbar.

OpenAPI beschreibt normalisierte öffentliche DTOs. TypeScript-Typen werden generiert; zusätzlich prüft ein Exporter-Check den aktuellen Server gegen die eingecheckte OpenAPI-Datei. Vite-Build ersetzt weder Typecheck noch Komponenten-/Browsertests.

Abnahme umfasst alte eingefrorene ZIP-/DB-Fixtures, gemischte Snapshot-Historien, unveränderte Reviewreferenzen, Receipt-Replay, eigene/leere Achsen im Workspace-Rundlauf, Nicht-HPO-Suche und Installation des frisch gebauten Wheels außerhalb des Checkouts. Der installierte Editor funktioniert nach Bereitstellung von Dependencies/Ontologie ohne Node.js oder Netzwerk. CI deckt Windows/Linux und den Chromium-Workflow ab.

## 8. Korrekturen gegenüber dem ersten Entwurf

Die vorgeschlagene Spaltenumbenennung und direkte Normalisierung vor der Hashprüfung sind ersetzt. Konkrete Profilvalidierung, CLI-Präzedenz, persistierte Auflösung, Exporterweiterung und vollständige Buildpfade sind verbindlich. Der zugehörige Plan ordnet diese Anforderungen sieben sequenziellen Aufgaben mit überprüfbaren Ergebnissen zu. Diese Dokumentänderung ist keine Implementierungsfreigabe oder Anwendungstest-Verifikation.
