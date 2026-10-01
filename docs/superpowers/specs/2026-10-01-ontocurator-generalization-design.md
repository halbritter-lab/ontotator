# Design: Generalisierung und Umbenennung zu Ontocurator

**Datum:** 2026-10-01
**Status:** In Prüfung
**Ziel:** Umbenennung von `hpo-annotation-editor` zu `ontocurator` und Generalisierung der Datenmodelle, Suche und UI für beliebige OBO-Foundry-Ontologien (HPO, Mondo, GO, ChEBI, ORDO etc.).

---

## 1. Motivation & Zielsetzung

Bisher war das Projekt auf die Human Phenotype Ontology (HPO) mit Bezeichnern wie `hpo-annotation-editor`, `hpo-editor` und Feldnamen wie `hpo_id` fokussiert. Da die Kernarchitektur (Text-Span-Indexing, Unveränderlichkeit, RFC-8785-Kanonisierung, Provenienz und Review-Workflows) vollständig ontologie-agnostisch ist und der OBO-Parser bereits OBO-IRIs generisch parst, wird das Projekt generalisiert:

1. **Marke & Namensraum:** Umbenennung in `ontocurator` (Python-Paket `ontocurator`, CLI-Befehl `ontocurator`, Repo-Name `ontocurator`).
2. **Generisches Datenmodell:** Generalisierung des Attributs `hpo_id` zu `term_id` (mit `hpo_id` als abwärtskompatiblem Alias).
3. **Ontologie-Präfix-Unterstützung:** Schnelleingaben (wie numerische IDs `1250`) ergänzen das Präfix der geladenen Ontologie (z. B. `HP:0001250` oder `MONDO:0001250`), unterstützen aber weiterhin beliebige CURIEs.
4. **Work-Package-Identifikator:** Aktualisierung von `hpo-editor-work-package/v1` auf `ontocurator-work-package/v1` (Abwärtskompatibilität beim Lesen alter Pakete bleibt gewährleistet).
5. **UI-Terminologie:** Neutrale, ontologie-unabhängige Beschriftungen („Ontology Concept / Term“ statt „HPO Term“).

---

## 2. Architektur & Komponenten

### 2.1 Backend & Paketstruktur
* `src/hpo_editor` wird nach `src/ontocurator` verschoben.
* `pyproject.toml`:
  * Projektname: `ontocurator`
  * CLI-Script: `ontocurator = "ontocurator.cli:main"` (optional `onto-curator` als Alias).
* Alle Importe werden von `hpo_editor.*` auf `ontocurator.*` aktualisiert.

### 2.2 Domänenmodell (`domain/annotations.py`)
* `Annotation`:
  * Neues primäres Feld: `term_id: str`
  * Validierung & Normalisierung: Beliebige gültige CURIEs (`^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$`).
  * Alias/Fallback: Bei Deserialisierung von Alt-Payloads wird `hpo_id` automatisch in `term_id` gemappt.
* `AnnotationSnapshot`:
  * RFC-8785-Kanonisierung nutzt `term_id`.
* SQLite-Schema:
  * Spalte `hpo_id` in Tabelle `annotations` wird zu `term_id` migriert (mit View/Kompatibilität in Migration).

### 2.3 Ontologie-Index & Suche (`ontology/service.py`, `vendor/hpo_span_annotator/`)
* Der OBO-Parser (`HPOTreeIndex` / `OntologyIndex`) liest bereits `_IRI_TAIL = re.compile(r"([A-Za-z]+)_(\d+)$")`.
* Erkennung des Standard-Präfixes: Aus der geladenen Datei (z. B. `hp.json` -> `HP`, `mondo.json` -> `MONDO`) wird das dominante Präfix abgeleitet.
* Bei numerischen Suchanfragen wird mit dem aktiven Präfix aufgefüllt.
* Explizite CURIE-Eingaben (`MONDO:0000001`, `HP:0001250`) werden unverändert gesucht.

### 2.4 Work-Package-Format v1
* Manifest `format_version`: `ontocurator-work-package/v1`.
* Import akzeptiert sowohl `ontocurator-work-package/v1` als auch `hpo-editor-work-package/v1`.
* Export erzeugt `ontocurator-work-package/v1`.

### 2.5 Frontend (UI & Typen)
* UI-Header: „Ontocurator – Local Ontology Annotation & Review“.
* Tabellen, Formulare, Labels: „Term / Concept ID“, „Term Label“.
* OpenAPI-Generierung: TypeScript-Typen spiegeln `term_id` wider.

---

## 3. Risiken & Abwärtskompatibilität
* **Bestehende Arbeitsbereiche / SQLite-Dateien:** Migration benennt die Spalte oder stellt über SQLite-Spaltenaliase Kompatibilität her.
* **Bestehende Zip-Archive:** Der Paket-Reader akzeptiert weiterhin Archive mit `hpo-editor-work-package/v1` und wandelt Alt-Einträge mit `hpo_id` verlustfrei in `term_id` um.
* **Testabdeckung:** Vollständige Test-Suite wird auf die neuen Paket- und Modulnamen umgestellt und muss grün durchlaufen.
