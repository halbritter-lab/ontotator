# Configured Annotation Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only if delegation is explicitly selected. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Konfigurierbare Pakete mit unabhängigen Ontologieschichten ermöglichen, ohne zusätzliche Pflichtbedienung im bisherigen HPO-Ablauf.

**Architecture:** Ein vollständiges Paketprofil definiert Ontologien, Schichten und Annotationstypen. Ein serverseitiger TaskScope trennt Arbeitsumfang von UI-Sichtbarkeit; eine Ontologieregistrierung ersetzt die globale Einzelontologie. Neue versionierte Verträge ersetzen Legacy-Unterstützung, während Evidenz-, Review- und Speichergarantien erhalten bleiben.

**Tech Stack:** Bestehender Python/FastAPI/Pydantic/SQLite-Kern, React/TypeScript, generierte OpenAPI-Typen, pytest, Vitest und Playwright. Keine neue Laufzeitplattform.

**Spec:** [Design](../specs/2026-10-02-configured-annotation-layers-design.md).

**Status:** Beauftragte Planung, noch nicht ausgeführt. Technische Entscheidungen sind Vorschläge zur Review. Produktcode, Datenbanken und laufende UI-Prozesse wurden für diesen Plan nicht verändert.

## Global Constraints

- Ein-Schicht-Pakete benötigen keinen zusätzlichen Auswahl- oder Bestätigungsschritt.
- Konfiguration wird vollständig mitgeliefert; Presets sind Vorlagen, keine Laufzeitabhängigkeit.
- Unabhängige Annotation liefert keine importierten Vorschläge oder daraus abgeleiteten Hinweise an den Browser.
- Sichtbarkeit ist Darstellung; Berechtigung und Abschlussumfang werden serverseitig bestimmt.
- Jede neue Annotation verwendet die Ontologie und Regeln ihrer Schicht und ihres Typs.
- Text bleibt unverändert; Offsets sind Unicode-Codepoints mit exklusivem Ende.
- Gemeinsame Evidenz wird bei Bearbeitung standardmäßig nur für die gewählte Annotation geändert.
- Review bindet konkrete Inhaltsversionen; eine Abgabe ist keine Goldfreigabe.
- Alte Paket-, Snapshot- und Workspaceformate werden nicht innerhalb des Annotators konvertiert.
- Benchmark-Aufbereitung, Goldregeln und mögliche Altbestandsmigration gehören außerhalb des Annotators.
- Lokal und offline, Loopback-Schutz, transaktionale Mutationen, Revisionen und idempotente Wiederholung bleiben erhalten.

## Review Focus

1. Gleiche Term-ID in zwei Ontologien: Labels, Suche und Validierung bleiben eindeutig (Task 3).
2. Wechsel bei verspäteter Suchantwort oder fehlgeschlagenem Autosave: keine falsche Schicht und kein Verlust lokaler Änderungen (Tasks 6–7).
3. Ausgeblendete Pflichtschicht oder leere Zielschicht: Abschlussumfang bleibt bestehen, Null-Befund bleibt möglich (Tasks 4–5).
4. Unabhängiger Modus mit reich annotierter Quelle: keine indirekten Leaks durch Status, API oder Export (Tasks 4–5).
5. Gemeinsame Evidenz zwischen schreibgeschützter Quelle und bearbeitbarem Ziel: Änderung beeinflusst ausschließlich das Ziel (Task 4).

## Durchführung und Arbeitsgrenze

Aufgaben sind sequenziell; sie verändern gemeinsam einen Paketvertrag. Kein
Zwischenstand wird als fertige Veröffentlichung behandelt. Vor Umsetzung den
Abschluss der laufenden UI-Arbeit abwarten, sauberen Ausgangsstand feststellen
und eine isolierte Arbeitskopie verwenden. Keine fremden Änderungen verwerfen.
Keine automatische Bereitstellung, Veröffentlichung oder Benchmark-Migration.

### Task 1: Ursprünglichen Ablauf als Abnahmekriterium festhalten

**Files:** Modify `frontend/browser/workflow.spec.ts`, `frontend/browser/spans.spec.ts`, `tests/test_reviews.py`, `tests/test_editing.py`; create `tests/fixtures/layered/README.md`.

**Interfaces:** Produces die in der Spec definierten Szenarien A/B/C und eine dokumentierte Liste der Pflichtinteraktionen des bestehenden Ein-Schicht-Ablaufs. Test-IDs werden an die neue Fixture-Erzeugung in Task 2 angeschlossen.

- [ ] Bestehenden UI-Stand nach Abschluss der parallelen Arbeit lesen; die Bedienfolge für unabhängige Annotation und Review in der Fixture-README festhalten. Keine visuelle Neugestaltung in diesen Auftrag ziehen.
- [ ] Bereits vorhandene Tests identifizieren; fehlende Szenarien für spanlose Annotation, wiederholte/diskontinuierliche Evidenz, Reviewkorrektur und Null-Befund-Abschluss ergänzen. Vorhandene Garantien zunächst am bisherigen Format prüfen.
- [ ] `uv run pytest tests/test_editing.py tests/test_reviews.py -q` und im Frontend `npm run test:e2e -- browser/workflow.spec.ts browser/spans.spec.ts` ausführen. Erwartet: PASS; bestehende Fehler separat dokumentieren und nicht als Ergebnis dieser Änderung darstellen.
- [ ] Testfälle für A auf das neue Paket umstellen, sobald Task 2 dessen Builder liefert. Sichtbare Auswahlfelder für Schicht/Ontologie/Typ müssen fehlen; die Zahl der Pflichtinteraktionen darf gegenüber der dokumentierten Folge nicht steigen.
- [ ] Nur eigene Tests und Szenariobeschreibung gezielt committen.

### Task 2: Profile und neue kanonische Verträge

**Files:** Create `src/ontocurator/domain/profiles.py`, `src/ontocurator/profiles/hpo-context-example-v1.json`, `tests/test_profiles.py`, `tests/layered_fixtures.py`; modify `domain/axes.py`, `domain/annotations.py`, `domain/serialization.py`, `domain/workspace.py`, `packages/models.py` unter `src/ontocurator/`; extend `tests/test_domain.py`.

**Interfaces:**
- `TaskProfile`, `OntologyDefinition`, `LayerDefinition`, `AnnotationTypeDefinition` mit genau den Feldern aus Spec §4.
- `resolve_layer(profile: TaskProfile, layer_id: str) -> LayerDefinition` und `resolve_type(profile: TaskProfile, layer_id: str, type_id: str) -> AnnotationTypeDefinition` schlagen bei unbekannten IDs fehl.
- `layer_config_hash(profile: TaskProfile, layer_id: str) -> str` bindet Definition und aufgelöste Ontologie.
- `snapshot(annotation: Annotation, evidence: list[EvidenceSnapshot], document: Document, profile: TaskProfile) -> AnnotationSnapshot` erzeugt ausschließlich V3.
- `make_layered_package(scenario: Literal["single", "assisted", "multi_editable"]) -> ValidatedPackage` in `tests/layered_fixtures.py` liefert vollständig synthetische Daten A/B/C.

- [ ] Failing tests schreiben: explizit leere Achsen gültig; doppelte/leere IDs, unbekannte Schichten/Typen, ungültige Defaultreferenzen und fehlende Ontologie abgelehnt. Gleiche Daten ergeben gleiche Hashes; andere Achsenwerte oder Ontologiedigests andere Snapshotversionen. Entfernen einer ungenutzten Schicht ändert den eigenen Schichthash nicht.
- [ ] `uv run pytest tests/test_profiles.py tests/test_domain.py -q` ausführen und erwartete Fehler vor Implementierung bestätigen.
- [ ] Modelle, Resolver, Hashfunktionen und strikten V3-Codec implementieren; `hpo_id`, `_legacy_wire` und automatische klinische Defaults entfernen. V2/schemafreie Snapshots ausdrücklich zurückweisen. Keine Presetnamen-Verzweigung im Domaincode.
- [ ] Fixtures und gewöhnliches HPO-Beispielprofil erzeugen; Szenario B enthält keine Mappingpflicht, Szenario C verschiedene Evidenz- und Achsenpflichten. Dokumentordnung darf sich von alphabetischer ID-Reihenfolge unterscheiden.
- [ ] Die gezielten Tests ausführen; Pflichtfelder sowohl im unvollständigen Entwurf als auch beim Abschluss prüfen. Nur diese Änderungen committen.

### Task 3: Ontologien registrieren und Pakete atomar bereitstellen

**Files:** Create `src/ontocurator/ontology/registry.py`, `tests/test_ontology_registry.py`; modify `ontology/service.py`, `ontology/provenance.py`, `packages/reader.py`, `packages/writer.py`, `config.py`, `cli.py`, `api/app.py`, `api/routes.py` unter `src/ontocurator/`; extend `tests/test_packages.py`, `tests/test_cli.py`.

**Interfaces:**
- `OntologyRegistry.register(path: Path, expected: OntologyDefinition) -> None` prüft Digest und unterstütztes Format.
- `OntologyRegistry.for_layer(profile: TaskProfile, layer_id: str) -> OntologyService` liefert genau den gebundenen Index; Cache nach SHA-256.
- Paketimport akzeptiert ausschließlich V2 mit vollständig eingebettetem Profil und gültiger `document_order`.
- `SearchRequest` ergänzt `layer_id`; die Serverantwort und `SearchEventRecord` binden `layer_id`, `ontology_sha256` und `index_identity`. Für bestehende Annotationen muss der Suchkontext zu deren Schicht passen.

- [ ] Failing tests für zwei Ontologien mit gleicher Term-ID und verschiedenen Labels, getrennte Suchindizes, mehrdeutige numerische Suche, falschen Hash, fehlende Ressource, unzulässige Archivpfade und doppelte Dokument-IDs schreiben.
- [ ] `uv run pytest tests/test_ontology_registry.py tests/test_packages.py tests/test_cli.py -q` ausführen; neue Fälle müssen vor Implementierung scheitern.
- [ ] Registry einführen; paketgebundene Ontologieauswahl ersetzt `app.state.ontology`. `--ontology PATH` optional und wiederholbar machen; eingebettete Ressourcen unter vorhandenen Größen-/Pfadgrenzen verarbeiten. Keine Netzwerkauflösung.
- [ ] Reader/Writer auf den neuen Vertrag umstellen und vor persistiertem Import alle Definitionen, Hashes und Ressourcen prüfen. Fehlende Ressourcen gesammelt melden; keine teilweise importierten Pakete oder globalen Cacheeinträge als gültigen Paketimport behandeln.
- [ ] Dieselben Tests erfolgreich ausführen und Änderungen committen. Nicht benötigte Ontologien nicht auf jedem Fallwechsel neu indexieren.

### Task 4: Arbeitsumfang, Speicherung und Bearbeitung nach Schicht

**Files:** Create `src/ontocurator/domain/scopes.py`, `src/ontocurator/storage/schema_v4.sql`, `tests/test_layered_editing.py`; modify `domain/workspace.py`, `storage/database.py`, `storage/repository.py`, `application/workspaces.py`, `application/editing.py` unter `src/ontocurator/`; extend `tests/test_storage_regressions.py`, `tests/test_api_regressions.py`.

**Interfaces:**
- `TaskScope(scope_id, mode, editable_layer_ids, reference_layer_ids)` gemäß Spec §6.
- `build_scope(profile: TaskProfile, mode: WorkspaceMode) -> TaskScope` erzeugt den gesamten festen Arbeitsumfang.
- `WorkspaceKey` ergänzt `scope_id`; `Draft` ersetzt `document_checked` durch `checked_layer_ids: list[str]`.
- `Repository.get_task_profile(package_id: str) -> TaskProfile` ersetzt paketweite Achsenauflösung.
- `CreateAnnotationCommand` enthält `layer_id`, `type_id`, `term_id`, `axes_values`; bestehende Änderungsbefehle leiten Regeln aus der gespeicherten Zielannotation ab.
- Neues `CheckLayerCommand(kind: Literal["check_layer"], layer_id: str, checked: bool)` durchläuft Revision und Receipt wie andere Mutationen.

- [ ] Failing tests: falsche Schicht/Typ, fremder Scope, Mutation einer Referenzschicht und Änderung von Schicht/Typ einer bestehenden ID abgelehnt. Evidenzkorrektur am Ziel lässt Quellsnapshot und Quellevidenz unverändert. Independent-Ansicht enthält keine importierten Annotationen oder deren abgeleitete Termstatusdaten.
- [ ] Test einer alten DB-Kopie: Öffnen führt zu `UNSUPPORTED_WORKSPACE_VERSION`; Dateiinhalt bleibt byteidentisch und es entstehen keine Migrationen. Leere/neue DB startet im Format `ontocurator-workspace/v4`.
- [ ] Tests zunächst ausführen: `uv run pytest tests/test_layered_editing.py tests/test_storage_regressions.py tests/test_api_regressions.py -q`.
- [ ] Versionsprüfung vor DDL einführen, neues Schema mit Profilen, Scope und schichtbezogenen Prüfmarken initialisieren. Alte Migrationspfade nicht aufrufen. Mitgliedschaft und lokale Ursprungsbindungen weiterhin strikt paketbezogen prüfen.
- [ ] Bearbeitung, Termvalidierung und Copy-on-write anhand aufgelöster Definitionen ausführen. Bestehende transaktionale Revision-/Receiptlogik übernehmen; alle Antwortdaten nach Modus filtern. Importierte Snapshots unverändert halten. Inhaltliche Mutationen entfernen nur die Prüfmarke der betroffenen Schicht; ein Test erhält zugleich die Prüfmarke der anderen Schicht und die historische Abgabe.
- [ ] Tests erfolgreich ausführen, einschließlich Retry mit verlorener Antwort und zwei konkurrierenden Browserrevisionen; Änderungen committen.

### Task 5: Review, Abschluss und verlustfreier Export

**Files:** Modify `src/ontocurator/application/reviews.py`, `submissions.py`, `exports.py` im selben Verzeichnis, `src/ontocurator/domain/review.py`, `src/ontocurator/domain/workspace.py`; create `tests/test_layered_workflows.py`; extend `tests/test_reviews.py`, `tests/test_packages.py`.

**Interfaces:** `Submission` enthält V2-Kennung, unveränderlichen `TaskScope`, `checked_layer_ids`, Zielmenge und gebundene Snapshots/Entscheidungen. `validate_completion(draft: Draft, profile: TaskProfile, scope: TaskScope) -> None` in `application/submissions.py` meldet fehlende Schichten oder Pflichtwerte explizit.

- [ ] Failing tests schreiben: Null-Befund in einer Schicht abschließbar; bei zwei editierbaren Schichten sind beide Prüfmarken nötig; reine Referenzschichten erzeugen keine Pflicht. Assisted erlaubt beliebige Anzahlen von Quell-/Zielannotation ohne Zuordnung. Review-Ersatz muss Schicht/Typ des Ziels behalten; spätere Änderung erfordert erneute Prüfung.
- [ ] Unabhängigen Export auf versteckte Annotationen, fremde Evidenz, Suchereignisse und abgeleitete Zähler prüfen. Eigene historische Snapshot-/Reviewhashes müssen nach Projektion des Profils, Export und Import in eine frische DB gleich bleiben.
- [ ] `uv run pytest tests/test_layered_workflows.py tests/test_reviews.py tests/test_packages.py -q` zunächst mit erwarteten neuen Fehlern ausführen.
- [ ] Abschlussvalidierung und Modusregeln implementieren. Geänderte Reviewentscheidungen entfernen die Prüfmarke ihrer Zielschicht; dies separat testen. Export enthält den durch Modus erlaubten fachlichen Umfang unabhängig von UI-Sichtbarkeit und transportiert alle erforderlichen Definitionen. Scope/Ursprungsbindung historischer Abgaben erhalten; lokale Bindung eines importierten Exports separat speichern, keine historischen Hashes umschreiben.
- [ ] Wiederöffnen nach Abgabe erzeugt einen neuen bearbeitbaren Stand, erhält die alte Abgabe und deren Scope. Tests erfolgreich ausführen und Änderungen committen.

### Task 6: API-Vertrag und sichere Clientzustände

**Files:** Modify `src/ontocurator/api/routes.py`, `src/ontocurator/application/workspaces.py`, `frontend/src/api/client.ts`, `frontend/src/editor/searchState.ts`, `frontend/src/editor/autosave.ts`, `frontend/src/api/generated.ts`, `contracts/openapi.json`; create `frontend/src/editor/layerState.ts`, `frontend/tests/layerState.test.ts`; extend `frontend/tests/searchState.test.ts`, `tests/test_api.py`.

**Interfaces:** `WorkspaceView` liefert aufgelöste zugängliche Definitionen, `TaskScope`, Prüfstatus und Termstatus nach `(layer_id, term_id)`. Dokumentliste liefert Paketposition und ausschließlich person-/modusbezogenen Arbeitsstatus. `LayerSelection` enthält `activeLayerId: string | null`, `activeTypeId: string | null`, `visibleLayerIds: string[]`. Suchkontext enthält Workspace-ID, Dokument-ID, Schicht-ID, Typ-ID und Anfragenummer.

- [ ] Failing tests für abgelehnte fremde Schichtkommandos und Suchanfragen, unabhängige Metadaten ohne Vorschlagszahlen sowie eine verspätete Suchantwort nach Schichtwechsel schreiben. Dieselbe Term-ID darf nicht zu gemeinsamem Status überschrieben werden.
- [ ] `uv run pytest tests/test_api.py -q` und im Frontend `npm test -- tests/layerState.test.ts tests/searchState.test.ts tests/autosave.test.ts` ausführen.
- [ ] API-DTOs und Clientzustände implementieren. Schicht-/Typauswahl ist lokaler Zustand; Requests nehmen die Identität beim Auslösen auf und lesen sie nicht später aus einer veränderten globalen Auswahl. Veraltete Suchantworten verwerfen.
- [ ] OpenAPI mit `uv run python scripts/export_openapi.py` und Frontendtypen mit `npm run api:generate` regenerieren; anschließend Exporter `--check`, `npm run api:check` und `npm run typecheck` ausführen.
- [ ] Gezielt Tests erfolgreich ausführen und Verträge zusammen mit Code committen.

### Task 7: Schichten und Fallnavigation ohne zusätzliche HPO-Schritte

**Files:** Create `frontend/src/editor/LayerControls.tsx`, `frontend/src/app/CaseNavigation.tsx`, `frontend/tests/layerControls.test.tsx`, `frontend/tests/caseNavigation.test.tsx`, `frontend/browser/layers.spec.ts`; modify `frontend/src/App.tsx`, `frontend/src/app/CaseScreen.tsx`, `frontend/src/editor/TextPane.tsx`, `AnnotationPanel.tsx`, `SearchPanel.tsx`, `ReviewActions.tsx` im Editor-Verzeichnis; change `frontend/src/styles.css` ausschließlich für nötige Komponenten.

**Interfaces:** `LayerControls` konsumiert zugängliche Definitionen und `LayerSelection`, meldet lokale Änderungen. `CaseNavigation` konsumiert `document_order`, aktuelle Fall-ID und `onNavigate(documentId: string): Promise<void>`. `CaseScreen` führt vor Navigation und aktiven Schichtwechseln `queue.flush()` aus. Fehler halten Fall, Auswahl und lokale Änderungen fest.

- [ ] Failing Komponententests: bei einer Schicht/einem Typ fehlen Zusatzcontrols; bei mehreren sind Sichtbarkeit und Aktivierung getrennt; Referenzschicht ist nicht editierbar. Ausblenden der aktiven Schicht setzt aktive Auswahl auf null, setzt aber keine Daten zurück. Prüfaktion betrifft ausschließlich die aktive editierbare Schicht.
- [ ] Navigationstests für nichtalphabetische Paketordnung, erste/letzte Position, direktes Springen, noch laufende Mutation, Speicherfehler und Konflikt schreiben. Weder Navigieren noch Ausblenden gilt als Abschluss.
- [ ] Im Frontend `npm test -- tests/layerControls.test.tsx tests/caseNavigation.test.tsx tests/caseScreen.test.tsx` zunächst mit erwarteten neuen Fehlern ausführen.
- [ ] Komponenten implementieren; bestehende visuelle Gestaltung erhalten. Bei mehreren zugänglichen Schichten Textkennzeichnungen und tastaturbedienbare Controls verwenden. Bei nur einem Typ dessen Auswahl ausblenden. Overlay-Hit-Testing auf sichtbare Schichten begrenzen und mehrdeutige überlappende Annotationen auswählbar halten.
- [ ] Browserfälle A/B/C implementieren: A führt dieselbe Bedienfolge wie Task 1 aus; B zeigt/verbirgt Quelle, annotiert unabhängig das Ziel; C prüft zwei Schichten mit unterschiedlichen Regeln. Präferenzen nach Neustart wiederherstellen, ohne Datenversionen zu ändern.
- [ ] `npm run typecheck`, `npm test` und `npm run test:e2e` ausführen; HPO-Pflichtinteraktionen gegen Task 1 vergleichen. Änderungen committen.

### Task 8: Legacy-Entfernung, Dokumentation und Releaseprüfung

**Files:** Modify `README.md`, `docs/work-package-v1.md`, `tests/test_compatibility.py`, `tests/test_release.py`, `scripts/create_demo_package.py`, `tests/browser_server.py`; create `docs/work-package-v2.md`; audit all `src/ontocurator/`, `frontend/src/`, build scripts and synthetic fixtures.

**Interfaces:** Dokumentierter V2-Vertrag und unterstützte aktuelle CLI; kein Leser für alte Formate. Die V1-Dokumentation bleibt als historischer Text gekennzeichnet und verweist auf V2. Vorhandene Legacy-Fixtures werden nur für explizite Ablehnung bzw. Unverändertheit alter Dateien verwendet.

- [ ] Tests für klare Ablehnung beider bisherigen Paketformatnamen, schemafreier/V2-Snapshots und Legacy-Aliasfelder schreiben. API/OpenAPI/Export dürfen `hpo_id` nicht als kompatibles öffentliches Feld anbieten.
- [ ] Verbleibende Legacy-Verzweigungen mit `rg -n 'legacy|hpo_id|editor-axes|clinical-phenotype|_legacy_wire' src frontend/src` prüfen. Alte Fachwörter in Vendorhistorie/Attribution sind keine öffentlichen Aliasverträge; keinen blinden Textaustausch vornehmen.
- [ ] CLI-Hilfe, README, Fixtures, Demo-Generator, Browser-Testserver und Releasechecks auf das neue Format umstellen. Benchmarkadapter und Konverter ausdrücklich als externe Folgearbeit dokumentieren. Kein tatsächlicher Altbestand wird geändert.
- [ ] Gesamte Backendprüfung ausführen: `uv run pytest -q`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy src`, `uv run python scripts/export_openapi.py --check`.
- [ ] Frontendprüfung ausführen: `npm run typecheck`, `npm run api:check`, `npm test`, `npm run test:e2e`.
- [ ] `uv run python scripts/build_release.py` ausführen. Frisches Wheel in isolierter Umgebung außerhalb des Checkouts mit neuer DB und synthetischen A/B-Paketen öffnen, bearbeiten, abschließen, neu starten und exportieren. Betrieb benötigt weder Node.js noch Netzwerk. Keine Veröffentlichung.
- [ ] Abschließende Abnahme gegen Spec §9 dokumentieren, inklusive null zusätzlicher HPO-Pflichtinteraktionen, Datenrundlauf und unverändert abgelehnter Alt-DB. Nur verifizierte Ergebnisse berichten und Änderungen committen.

## Planungsprüfung

Die Anforderungen der Spec sind den Aufgaben zugeordnet: ursprünglicher Zweck
(1, 7, 8), Profile und Versionen (2), Ontologien und Paketressourcen (3), Scope
und unabhängige Annotation (4), Review/Abschluss/Export (5), API und Suchwechsel
(6), Navigation und Sichtbarkeit (7), Formatbruch und Auslieferung (8).
Die fünf Reviewrisiken haben konkrete Testaufgaben. Es gibt keine Mappingpflicht,
keinen Preset-Laufzeitfallback und keinen projektspezifischen Legacy-Adapter.

Vor Umsetzung Design und Plan gemeinsam reviewen; dieser Auftrag endet mit
Planungsdokumenten. Die Ausführung und eine spätere Benchmark-Anbindung sind
separate Schritte.
