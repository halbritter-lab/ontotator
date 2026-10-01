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

### 2.3 Konfigurierbare & dynamische Kontextachsen (`domain/axes.py`)
* Bisher waren `assertion`, `experiencer` und `temporality` fest in `Axes` eincodiert.
* **Neues Modell `AxisDefinition` & `AxesConfig`:**
  ```python
  class AxisOption(BaseModel):
      id: str
      label: str

  class AxisDefinition(BaseModel):
      id: str
      label: str
      options: list[str]  # oder list[AxisOption]
      allow_empty: bool = True

  class Axes(BaseModel):
      definition_name: str = "clinical-phenotype/v1"
      values: dict[str, str] = Field(default_factory=dict)
  ```
* **Abwärtskompatibilität:**
  * Eingaben mit alten Einzelfeldern (`{"assertion": "present", ...}`) werden automatisch in `values={"assertion": "present"}` normalisiert.
  * Convenience-Properties `.assertion`, `.experiencer`, `.temporality` bleiben für Abwärtskompatibilität als Getter/Setter auf `values` erhalten.
* **Work-Package & Server-Config:**
  * `manifest.json` enthält `axes_definition` (Name) und optional `axes_config: list[AxisDefinition]`.
  * Standard-Profile: `"clinical-phenotype/v1"` (oder `"editor-axes/v1"`) enthält die 3 bekannten klinischen Achsen.
  * Eigene Profile (oder leere Achsen `[]` für reine Vokabulare/Gene/Krankheiten) werden direkt im Paket oder per CLI `--axes-config` bereitgestellt.
* **Dynamische Benutzeroberfläche:**
  * Das Backend liefert im Workspace-View die `axes_config` mit.
  * Das React-Frontend rendert Dropdowns dynamisch über die konfigurierten Achsen.
  * Ist `axes_config` leer (`[]`), wird der Achsenbereich in der UI automatisch ausgeblendet.

### 2.4 Ontologie-Index & Suche (`ontology/service.py`, `vendor/hpo_span_annotator/`)
* Der OBO-Parser (`HPOTreeIndex` / `OntologyIndex`) liest bereits `_IRI_TAIL = re.compile(r"([A-Za-z]+)_(\d+)$")`.
* Erkennung des Standard-Präfixes: Aus der geladenen Datei (z. B. `hp.json` -> `HP`, `mondo.json` -> `MONDO`) wird das dominante Präfix abgeleitet.
* Bei numerischen Suchanfragen wird mit dem aktiven Präfix aufgefüllt.
* Explizite CURIE-Eingaben (`MONDO:0000001`, `HP:0001250`) werden unverändert gesucht.

### 2.5 Work-Package-Format v1
* Manifest `format_version`: `ontocurator-work-package/v1`.
* Import akzeptiert sowohl `ontocurator-work-package/v1` als auch `hpo-editor-work-package/v1`.
* Export erzeugt `ontocurator-work-package/v1`.
* Enthält `axes_definition` und optional `axes_config`.

### 2.6 Frontend (UI & Typen)
* UI-Header: „Ontocurator – Local Ontology Annotation & Review“.
* Tabellen, Formulare, Labels: „Term / Concept ID“, „Term Label“.
* Dynamische Achsen-Komponente statt statischer Dropdowns.
* OpenAPI-Generierung: TypeScript-Typen spiegeln `term_id` und dynamische `Axes` wider.

---

## 3. Risiken & Abwärtskompatibilität
* **Bestehende Arbeitsbereiche / SQLite-Dateien:** Migration speichert `values` als JSON-Objekt oder migriert Spalten verlustfrei.
* **Bestehende Zip-Archive:** Der Paket-Reader akzeptiert weiterhin Archive mit `hpo-editor-work-package/v1`, mappt `assertion/experiencer/temporality` in `values` und ordnet `editor-axes/v1` zu.
* **Testabdeckung:** Vollständige Test-Suite wird auf die neuen Paket- und Modulnamen umgestellt und muss grün durchlaufen.

