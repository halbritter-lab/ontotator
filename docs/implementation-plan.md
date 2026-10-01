# Local HPO Editor with Python — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Für dieses Vorhaben wird direkte Umsetzung mit `executing-plans` empfohlen; die Ausführungsmethode ist noch nicht gewählt.

**Goal:** Eine eigenständige lokale Anwendung zum Annotieren und Prüfen von HPO-Annotationen beliebiger Herkunft bereitstellen, mit überprüfbarem Import-/Export-Rundlauf.

**Architecture:** Ein lokaler Python-Prozess betreibt API, Ontologiesuche, SQLite-Arbeitsbereich und die gebaute Browseroberfläche. Pydantic definiert die Serververträge; TypeScript-API-Typen werden daraus über OpenAPI generiert. Unveränderliche Eingaben und Abgaben sind von veränderlichen, revisionsgeschützten Entwürfen getrennt.

**Tech Stack:** Python >=3.11, uv, FastAPI, Uvicorn, Pydantic v2, sqlite3, rfc8785; vorhandene scikit-learn-basierte lexikalische Suche; TypeScript, React, Vite, npm, openapi-typescript; pytest, Ruff, mypy, Vitest, Playwright. Exakte kompatible Versionen bei Repositoryanlage in `uv.lock` und `package-lock.json` festschreiben; kein `latest` in reproduzierbaren Build-Kommandos.

**Spec:** [Lokaler HPO-Editor](../specs/2026-10-01-local-hpo-editor-design.md). Planungsauftrag vom 2026-10-01; dieser Plan startet noch keine Implementierung.

## Global Constraints

- Eigenständiges Repository `C:/Users/jan-p/Development/hpo-annotation-editor`; vorhandene gleichnamige Verzeichnisse vor Anlage prüfen, nicht überschreiben.
- Menschliche und maschinelle Eingaben verwenden dasselbe Annotationsmodell, dieselben Import-, Bearbeitungs-, Validierungs-, Review- und Exportregeln.
- Zunächst genügt eine ärztliche Prüfung pro Fall; getrennte Datensätze für weitere Prüfende, keine Zusammenführungsoberfläche.
- Der primäre Einstieg ist das Markieren von Text. Annotationen ohne Belegstelle sind ausdrücklich möglich.
- Offsets sind nullbasierte Unicode-Codepoint-Intervalle mit exklusivem Ende im unveränderlichen importierten Text.
- Reviewer-Unsicherheit ist eine Reviewentscheidung und keine klinische Assertion.
- Unabhängige Annotation liefert keine Vorschläge an den Browser aus.
- Die Anwendung funktioniert nach Installation und Bereitstellung der gepinnten HPO-Datei ohne externe Dienste.
- Kein kanonischer Benchmark-Export, kein implizites Abflachen gruppierter Evidenz, keine Schema-Migration im Editor.
- Herkunft begründet weder automatische Annahme noch Ablehnung; klinische Werte bleiben ohne bewusste Angabe unbekannt.
- Laufzeit nur Loopback, ein Python-Dienst; Node.js ist Build-Werkzeug, kein zusätzlicher Dienst für Anwender.
- Alle Tests nutzen synthetische Texte und kleine Ontologie-Fixtures. Reale Texte bleiben außerhalb des Repositorys.

## Review Focus

1. Zwei Browserfenster bearbeiten denselben Fall: kein stilles Überschreiben, sichtbarer Konflikt (Aufgaben 3, 6, 9).
2. Paket mit gleichem `(id, version)`-Schlüssel und anderen Inhalten oder manipulierten Archivpfaden: atomare Zurückweisung ohne Altbestand zu ändern (Aufgabe 2).
3. Nicht-BMP-Zeichen, kombinierende Zeichen und CRLF: gleiche Belegstelle vor und nach Speicherung und Export (Aufgaben 1, 5, 10).
4. Unvollständige oder obsolete importierte Annotation: sichtbar und prüfbar, keine erfundenen Kontextwerte, keine unzulässige Bestätigung (Aufgaben 4, 7, 9).
5. Speicherfehler während schneller Eingaben und verzögerte Suchantworten: Entwurf bleibt sichtbar, alter Response ersetzt keinen neueren Zustand (Aufgaben 8, 9).

## Umfang und Reihenfolge

Aufgaben 1–7 liefern den validierten lokalen Kern und wiederverwendbare Span-/Suchfunktionen. Aufgaben 8–10 verbinden sie zur bedienbaren Anwendung und prüfen das auslieferbare Paket. Ein echtes E3C-Arbeitspaket folgt als getrennte Pipeline-Aufgabe; es ist Voraussetzung für den ärztlichen Pilot, nicht für die technische Abnahme dieses Editors.

Die frühere Schätzung von insgesamt 10–15 Entwicklungstagen ist eine unverbindliche Größenordnung. Nach Aufgaben 4 und 5 anhand der tatsächlichen Wiederverwendbarkeit neu bewerten. Keine automatische Ausweitung auf Cloudbetrieb, Schema v2 oder Mehrpersonen-Abgleich.

## Repository- und Dateistruktur

Alle folgenden Pfade beziehen sich auf das **neue Editor-Repository**. Dieser Plan und die Spezifikation werden dort vor Implementierung nach `docs/` kopiert, damit das Repository eigenständig verständlich ist.

```text
pyproject.toml, uv.lock, README.md, .gitignore
docs/design.md, docs/implementation-plan.md, docs/work-package-v1.md
THIRD_PARTY_NOTICES.md, LICENSES/hpo-span-annotator-MIT.txt
src/hpo_editor/
  cli.py, config.py
  domain/{documents,annotations,review,workspace,axes,canonical}.py
  packages/{models,reader,writer}.py
  storage/{database,repository}.py
  storage/migrations/001_initial.sql
  ontology/{service,provenance}.py
  vendor/hpo_span_annotator/{hpo,lexical,search}.py
  application/{workspaces,editing,reviews,submissions,exports}.py
  api/{app,security,schemas,packages,workspaces,ontology}.py
  web/                         # gebaute, paketierte Assets
scripts/export_openapi.py, scripts/build_release.py
contracts/openapi.json
frontend/
  package.json, package-lock.json, vite.config.ts, tsconfig.json
  src/api/{generated,client}.ts
  src/spans/{offsets,adapter}.ts
  src/vendor/spans.js
  src/app/{App,PackageScreen,CaseScreen}.tsx
  src/editor/{TextPane,AnnotationPanel,SearchPanel,ReviewActions}.tsx
  src/editor/{autosave,searchState}.ts
  src/styles.css
  tests/{offsets,spans,autosave,searchState}.test.ts
  tests/e2e/{annotation,review,release}.spec.ts
tests/
  fixtures/{hp.json,mixed_package/}
  test_domain.py, test_packages.py, test_storage.py, test_ontology.py
  test_editing.py, test_reviews.py, test_api.py, test_release.py
.github/workflows/ci.yml
```

`vendor` enthält nur nachgewiesen benötigte Funktionen plus Herkunftsnachweis. Kein unversionierter Import aus einem benachbarten Checkout; dessen vorhandene `.demo/`-Daten nicht übernehmen oder verändern. Neue Anwendungslogik liegt außerhalb des vendorten Codes.

## Gemeinsame Verträge

Diese Namen sind verbindliche Planungsvorschläge für alle Aufgaben:

- `ActorRef(actor_id, kind)` mit `kind: human | tool`; `Provenance(actor, method, source_refs, assessment?)` bewahrt Herkunft, bestimmt aber keine Aktionen.
- `Document(document_id, text, language, text_sha256)` bindet SHA-256 an UTF-8-Bytes ohne Normalisierung. `OntologyRef(release, sha256)` bindet die Ontologiedatei.
- `Segment(start, end)`; `EvidenceMention(evidence_id, segments, cue_segments=[])`; mehrere Segmente innerhalb einer Erwähnung sind sortiert, nichtleer und überlappen sich nicht. Verschiedene Erwähnungen dürfen überlappen. `EvidenceSnapshot(mention, document_id, text_sha256, version)` bindet unveränderlichen Inhalt an den Text; `EvidenceRef(evidence_id, version)` referenziert genau diesen Stand. Der Evidenzhash verwendet dieselbe Kanonisierung wie der Annotationshash.
- `Annotation(annotation_id, document_id, hpo_id, axes, evidence_refs, provenance)` referenziert Evidenz über `EvidenceRef`; `Axes(assertion, experiencer, temporality)` nutzt die Spezifikationswerte oder `null`. Eingebauter Definitionsname: `editor-axes/v1`.
- `AnnotationSnapshot(annotation, evidence, version)` bindet mit seinem Hash die Annotation, referenzierte Evidenz, Text- und Ontologieidentität sowie Achsendefinition. IDs sind UUIDs; `version` ist SHA-256 über RFC-8785-kanonisierte Inhalte ohne das Hashfeld.
- `AnnotationRef(annotation_id, version)`; `ReviewDecision(decision_id, target, outcome, replacement?, note?, reviewer_id)` mit `outcome: confirmed | rejected | changed | uncertain`. `changed` verlangt eine konkrete Ersatzversionsreferenz; andere Outcomes erlauben sie nicht.
- `ReviewTargetSet(target_set_id, targets)` enthält sortierte eindeutige `AnnotationRef`s; `target_set_id` ist deren kanonischer Hash. Die Auswahl gilt für eine Reviewrunde unveränderlich; eine andere Auswahl startet einen anderen Workspace. Independent verwendet die leere Menge.
- `WorkspaceKey(package_id, document_id, annotator_id, mode, target_set_id)` mit `mode: independent | review`; `Draft(key, targets, revision, annotations, evidence, decisions, document_checked)`.
- `Submission(submission_id, origin_key, targets, draft_revision, snapshots, decisions, document_checked, created_at)` ist unveränderlich und kein Benchmark-Gold. `origin_key` bezeichnet den historischen Ursprungsworkspace und wird beim Import niemals umgeschrieben. `ImportedSubmissionBinding(local_key, submission_id)` ordnet eine importierte Abgabe dem aktuellen lokalen Paket zu, außerhalb ihres unveränderlichen Inhalts. Fortsetzen erzeugt einen lokalen Draft mit Herkunftsverweis auf die Abgabe. Eine spätere Entwurfsrevision entfernt frühere Abgaben nicht.
- `MutationEnvelope(mutation_id, expected_revision, payload)` identifiziert einen Schreibversuch über Retries hinweg. Ein transaktional gespeicherter `MutationReceipt(workspace_key, mutation_id, request_hash, response)` erlaubt identische Wiederholung ohne erneute Mutation. Dieselbe ID mit anderem Request wird abgewiesen; Receiptprüfung erfolgt vor Revisionsprüfung. Receipt und Datenänderung werden gemeinsam committed.
- `DomainError(code, details)` ist Basis für `RevisionConflict`, `InvalidPackage`, `InvalidAnnotation` und `IncompleteReview`; die API mappt sie gezielt auf 409 oder 422, ohne lokale Pfade/Stacktraces auszuliefern.

Arbeitspaket `hpo-editor-work-package/v1`: ZIP mit `manifest.json`, `documents.jsonl`, `annotations.jsonl`, `evidence.jsonl`, `submissions.jsonl` und `search-events.jsonl`. Manifest enthält Paket-ID, Formatversion, Ontologieidentität, Achsendefinition und SHA-256 je Datendatei. Historische Paketverweise enthalten Ursprungs-ID und Manifesthash; sie sind Provenienz und verlangen keine Installation des Ursprungspakets. Alle tatsächlichen Annotations-/Evidenz-/Reviewreferenzen müssen dagegen im exportierten Paket auflösbar sein. `annotations.jsonl` und `evidence.jsonl` enthalten unveränderliche Snapshots mit Schlüssel `(id, version)`, nicht nur den jeweils letzten Stand. Annotierende, Reviewzielmengen und Entscheidungen sind in den Abgaben enthalten. Jede importierte Annotationsversion kann als Revieweingabe ausgewählt werden, unabhängig von Provenienz und bisherigen Entscheidungen. Entwürfe werden im ersten Stand lokal gespeichert; Dateiexport transportiert unveränderliche Eingaben und Abgaben, keine laufenden Autosave-Zustände.

## Aufgabe 1: Eigenständiges Repository und Domänenverträge

**Dateien:** Repositorygrundlagen, `domain/*.py`, `tests/test_domain.py`, `tests/fixtures/hp.json`, `docs/design.md`, `docs/implementation-plan.md`.

**Schnittstellen:** Erzeugt alle oben genannten Domänentypen sowie `snapshot(annotation, evidence, document, ontology) -> AnnotationSnapshot` und `validate_segments(text: str, mentions: list[EvidenceMention]) -> None`.

- [ ] Zielpfad und anwendbare `AGENTS.md` prüfen; eigenes Git-Repository initialisieren, falls noch nicht vorhanden. Keine Änderungen im vorhandenen Annotator. Spezifikation und Plan kopieren; Python-Paket, uv-Lock und Testkonfiguration anlegen.
- [ ] Tests `test_origin_does_not_change_validation`, `test_unknown_axes_remain_null`, `test_evidence_edit_changes_version_not_id` und `test_codepoint_offsets` schreiben. Kernassertionen: `before.annotation_id == after.annotation_id`, `before.version != after.version`, `"A😀e\u0301\r\nB"[1:2] == "😀"`; leere/negative/zu lange Segmente werden abgewiesen.
- [ ] `uv run pytest tests/test_domain.py -q` ausführen; die noch fehlenden Domänenfunktionen müssen als Ursache des Fehlschlags erkennbar sein.
- [ ] Strikte Pydantic-Modelle mit verbotenen Zusatzfeldern, den oben definierten Enums, eindeutigen Referenzen und kanonischen Hashes implementieren. Klinische Unbekanntheit durch `null` erhalten. Evidenzlisten vor Hashbildung über stabile IDs ordnen.
- [ ] Domänentests erneut ausführen; alle bestehen. Commit: `feat: define versioned editor domain contracts`.

## Aufgabe 2: Validierter und atomarer Paketrundlauf

**Dateien:** `packages/{models,reader,writer}.py`, `docs/work-package-v1.md`, `tests/test_packages.py`, `tests/fixtures/mixed_package/`.

**Schnittstellen:** Verwendet Aufgabe 1. Erzeugt `ValidatedPackage`, `read_package(path: Path) -> ValidatedPackage`, `write_package(package: ValidatedPackage, target: Path) -> None`. Der Reader verändert keinen Arbeitsbereich.

- [ ] Tests für gemischte Herkunft, Text-/Dateihashes, unbekannte Versionen, unbekannte Referenzen, kollidierende `(id, version)`-Schlüssel, wiederholten Import und Archivpfade schreiben. Unterschiedliche gültige Versionen derselben stabilen ID sind erlaubt; gleicher Versionsschlüssel mit anderem Inhalt wird abgewiesen. Assert `read_package(exported) == original` für kanonische Nutzdaten; Export muss gruppierte und gemeinsame Evidenz, Abgaben und Suchprovenienz erhalten. Zwei Abgaben vor/nach einer Evidenzkorrektur gemeinsam exportieren und in frischer Installation lesen; beide Evidenz- und Annotationsversionen bleiben erhalten.
- [ ] `uv run pytest tests/test_packages.py -q` ausführen und Fehlschlag prüfen.
- [ ] Manifest-/JSONL-Vertrag vollständig dokumentieren und implementieren. Nur die sechs festgelegten Dateinamen zulassen; keine Symlinks, Pfadtraversierung oder doppelten ZIP-Einträge. Limits: 64 MiB komprimiert, 256 MiB entpackt, 10.000 Dokumente, 2 MiB UTF-8 pro Text; Überschreitung mit erklärbarem Fehler. Streamend zählen statt nur Archivheadern vertrauen.
- [ ] Hashes, globale Referenzen und Schema prüfen, bevor `ValidatedPackage` entsteht. Archiv nie in frei gewählte Pfade entpacken; Export über temporäre Datei und atomaren Austausch, bestehendes Ziel nur nach ausdrücklicher Auswahl in der UI ersetzen.
- [ ] Pakettests ausführen; alle bestehen. Commit: `feat: add lossless validated work packages`.

## Aufgabe 3: SQLite-Arbeitsbereiche mit Revisionsschutz

**Dateien:** `storage/{database,repository}.py`, `storage/migrations/001_initial.sql`, `tests/test_storage.py`.

**Schnittstellen:** `Repository.import_package(package: ValidatedPackage) -> str`, `open_draft(key: WorkspaceKey) -> Draft`, `save_draft(draft: Draft, expected_revision: int) -> Draft`, `append_submission(submission: Submission, expected_revision: int) -> None`, `export_package(package_id: str) -> ValidatedPackage`. Ein gemeinsamer Wrapper `run_mutation(key, envelope: MutationEnvelope, operation) -> MutationResponse` führt Receiptprüfung, Operation und Receiptspeicherung in derselben SQLite-Transaktion aus. Die internen Schreibmethoden eröffnen keine unabhängige Transaktion. Keine direkten Repositoryaufrufe aus der Browseroberfläche.

- [ ] Tests für konkurrierende Revisionen, Transaktionsrollback, Daten nach Prozessneustart, getrennte Annotierende und unveränderliche Abgaben schreiben. Nach zwei Writes auf Revision 0 gilt `saved.revision == 1`; der zweite Write wirft `RevisionConflict`, gespeicherter Inhalt bleibt der erste.
- [ ] Test `test_committed_write_with_lost_response_replays_once` ergänzen: Commit erfolgreich, Antwort verworfen, identischen Envelope erneut senden. Ergebnis ist derselbe Receipt, Revision wird nicht erneut erhöht; ein nachfolgender neuer Edit funktioniert. Reuse derselben Mutation-ID mit anderem Payload gibt 409; Rollback hinterlässt weder Write noch Receipt.
- [ ] `uv run pytest tests/test_storage.py -q` ausführen und Fehlschlag prüfen.
- [ ] SQLite-Schema für Pakete, unveränderliche Snapshots mit `(id, version)`-Schlüsseln, Entwürfe, Abgaben, Importbindungen und Suchereignisse implementieren; Fremdschlüssel aktivieren. Historische Paketidentitäten sind Provenienz, keine Fremdschlüssel auf installierte Pakete. Revision mittels bedingtem Update in einer Transaktion prüfen. Unbekannte neuere DB-Version beim Öffnen ablehnen.
- [ ] Gleiche Paket-ID und gleicher Manifesthash importieren idempotent; gleiche Paket-ID und anderer Hash zurückweisen. Neue Abgaben werden unter ihrer ID angehängt, identische Abgaben dedupliziert, niemals überschrieben. Exporte mit zusätzlichem Inhalt erhalten eine neue Paket-ID und einen Herkunftsverweis.
- [ ] Tests erneut ausführen, einschließlich erzwungenem Fehler während Paketimport: kein Teilbestand. Zusätzlich Export P→Q, Import von Q ohne installiertes P, Lesen unveränderter Abgabe und Fortsetzen unter lokalem Q-Workspace testen; Inhalt/Hash der ursprünglichen Abgabe bleiben identisch. Commit: `feat: persist revisioned local workspaces`.

## Aufgabe 4: Vorhandene HPO-Suche gezielt übernehmen

**Dateien:** `vendor/hpo_span_annotator/{hpo,lexical,search}.py`, `ontology/{service,provenance}.py`, Lizenznachweise, `tests/test_ontology.py`.

**Quelle:** `../hpo-span-annotator`, geprüfte Revision `27c5dad`; vollständige Commit-ID vor Übernahme ermitteln und dokumentieren. `hpo.py`, `lexical.py` und nicht-semantische Suchwege übernehmen; dichte Suche, Hub, Server und altes Speichermodell nicht einbinden.

**Schnittstellen:** `OntologyService.load(path: Path, expected: OntologyRef) -> OntologyService`, `search(request: SearchRequest) -> SearchResult`, `validate_term(hpo_id: str) -> TermStatus`, `hierarchy_warnings(ids: list[str]) -> list[HierarchyWarning]`. `SearchRequest` enthält WorkspaceKey, eine vorab erzeugte stabile Annotations-ID, Query, Route und k; `SearchResult` enthält Such-ID, sichtbare Kandidaten und Indexidentität. Rang und Anzeigeposition speichert das Backend separat, der echte Rang wird nicht in der UI angezeigt.

- [ ] Tests für ID/Label/Synonym, lexikalische Treffer, transitive Hierarchie, obsolete IDs und falsche Ontologiehashes schreiben. Gleiches Seedmaterial ergibt identische Reihenfolge; `set(displayed_ids) == set(ranked_ids)`; andere Suchwege werden nicht gemischt. Hierarchieprüfung darf nicht nach den ersten 24 Vorfahren abbrechen.
- [ ] `uv run pytest tests/test_ontology.py -q` ausführen und Fehlschlag prüfen.
- [ ] Module mit Lizenznachweis übernehmen, Importe anpassen und Adapter implementieren. Lexikalische Suche bleibt char-wb-TF-IDF mit n-Grammen 3–5, maximaler Namensscore pro HPO-Term und vorhandener Seedlogik. Keine unbeabsichtigten Netzwerkaufrufe oder Modell-Downloads.
- [ ] Optionale lokale Übersetzungsdateien nur mit Hashes laden; ihre Hashes, Indexparameter und Version in Indexidentität aufnehmen. Ohne Zusatzdateien mit den gelieferten Namen/Synonymen arbeiten. Keine vollständige deutsche Terminologieabdeckung behaupten.
- [ ] Auswahl eines Treffers muss auf ein gespeichertes Suchereignis zeigen; fehlende, unbekannte und obsolete Terme als unterscheidbare Zustände liefern. Tests ausführen, Wiederverwendungsbefund dokumentieren. Commit: `feat: reuse pinned HPO search with provenance`.

## Aufgabe 5: Span-Komponente mit expliziten Unicode-Grenzen

**Dateien:** `frontend/package.json`, Lockfile und TS-/Vitest-Konfiguration, `src/vendor/spans.js`, `src/spans/{offsets,adapter}.ts`, `tests/{offsets,spans}.test.ts`, Lizenznachweis.

**Schnittstellen:** `toUtf16(text: string, codepoint: number): number`, `toCodepoint(text: string, utf16: number): number`; `mountSpanEditor(element, text, mentions, onSelection, onPick): SpanEditorHandle` mit `setMentions`, `setSelected`, `setSelectionIntent`, `destroy`. `onSelection` liefert `{segments, intent: new_mention | extend_mention, evidence_id?}` in Codepoint-Offsets. `extend_mention` verlangt die ausgewählte Evidenz-ID; `onPick(evidence_id)` erhält die Auswahl vorhandener Erwähnungen. Oberfläche besitzt keine zweite autoritative Offsetdarstellung.

- [ ] Tests für `A😀e\u0301\r\nB`, Auswahl über mehrere DOM-Knoten, Überlappung, Verschachtelung sowie wiederholte/unterbrochene Erwähnungen schreiben. Assert `toUtf16(text, 2) === 3`, `toCodepoint(text, 3) === 2`; UTF-16-Grenze mitten im Surrogatpaar wird abgewiesen. Rendern und Einlesen erhalten den Originaltext exakt.
- [ ] In `frontend`: `npm test -- --run tests/offsets.test.ts tests/spans.test.ts` ausführen und Fehlschlag prüfen.
- [ ] Vorhandenes `ui/spans.js` übernehmen und mit separatem Adapter anbinden. Dessen interne UTF-16-Indizes bleiben intern. Sicherstellen, dass whitespace-/NBSP-Verarbeitung und DOM-Rekonstruktion keine Textabweichung verursachen; notwendige Vendoränderungen separat dokumentieren.
- [ ] Keine gemeinsame Evidenz durch Rendernormalisierung zusammenführen; Gruppenidentität kommt aus dem Domänenmodell. Vendor-Callbacks `onPaint` einschließlich `additive` und `onPick` explizit adaptieren. Test: zwei neue Markierungen ergeben zwei Erwähnungen; „Weiteres Segment“ ergänzt eine gewählte Erwähnung. Vorschlagsmarkierungen stehen für Reviewzustand, nicht für maschinelle Herkunft.
- [ ] Tests ausführen; falls Kernfälle nur mit grundlegender Neuentwicklung möglich sind, Befund und Aufwand vor Ausweitung melden. Commit: `feat: adapt span editor to Unicode evidence model`.

## Aufgabe 6: Bearbeitung und Review als Anwendungslogik

**Dateien:** `application/{workspaces,editing,reviews,submissions,exports}.py`, `tests/test_editing.py`, `tests/test_reviews.py`.

**Schnittstellen:** `WorkspaceService.open(key, targets: ReviewTargetSet) -> WorkspaceView`, `EditorService.apply(key, mutation: MutationEnvelope) -> Draft`, `ReviewService.decide(key, mutation: MutationEnvelope) -> Draft`, `SubmissionService.submit(key, mutation: MutationEnvelope) -> Submission`, `SubmissionService.read(key, submission_id: str) -> Submission`, `ExportService.for_workspace(key: WorkspaceKey) -> ValidatedPackage`. Payloads sind `EditCommand`, `DecisionCommand(target, outcome, replacement, note)` oder `SubmitCommand(document_checked)`. Alle Schreibservices verwenden `run_mutation`; Lesezugriffe prüfen lokale Workspacebindung. `MutationResponse` ist die diskriminierte Antwortunion aus Draft und Submission. Services verwenden Repository und OntologyService. `WorkspaceView` enthält Dokument, sichtbare Eingaben, Draft und Abgabeübersicht; im independent-Modus sind Eingaben und Zielmenge leer. Öffnen prüft Zielhash und Dokumentbindung und persistiert die Zielmenge.

- [ ] Parametrisierte Tests für `kind=human/tool` schreiben: identische Aktionen und Zustandsübergänge. Testfälle für alle vier Reviewentscheidungen, neue Annotation, spanlos→mit Span bei gleicher ID, geteilte Evidenz, veraltete Gegenfassung und Null-Befund-Abschluss ergänzen.
- [ ] `uv run pytest tests/test_editing.py tests/test_reviews.py -q` ausführen und Fehlschlag prüfen.
- [ ] `EditCommand` als diskriminierte Union implementieren: `create_annotation`, `set_term`, `set_axes`, `attach_mention`, `edit_mention`, `detach_mention`, `delete_draft_annotation`. Änderung importierter Annotation erzeugt eine Gegenfassung mit Quellverweis; keine Mutation der Eingabe. Geteilte Evidenz bei Bearbeitung für die ausgewählte Annotation kopieren.
- [ ] Bestätigen bindet Eingabeversion, Ändern bindet Eingabe- und Ersatzversion. Bearbeitung einer bereits verknüpften Ersatzversion markiert die Entscheidung als erneut zu prüfen. Unbekannte Achsen bleiben sichtbar, schließen aber einen lokalen Reviewabschluss nicht automatisch aus. Obsolete/unbekannte HPO-IDs dürfen verworfen, als unsicher markiert oder durch gültige Terme ersetzt, aber nicht bestätigt werden.
- [ ] Abschluss verlangt unveränderte referenzierte Versionen, genau eine aktuelle Entscheidung für jedes Element der gespeicherten Zielmenge und `document_checked=True`. Entscheidungen außerhalb der Zielmenge ablehnen. Testpaket enthält alte Version A1, neue A2 und Gegenfassung B: Auswahl nur von A2/B erzeugt keine Pflicht zur Prüfung von A1 und bleibt über Neustart/Abgabe erhalten. Ergebnis mit `uncertain` bleibt ausdrücklich kein Gold. Nach Abschluss kann ein neuer Entwurfsstand geöffnet werden; frühere Abgaben bleiben lesbar.
- [ ] Browserexport über ExportService auf den gewählten Workspace und seine transitiven Abhängigkeiten begrenzen. Independent-Export enthält dessen eigene Abgaben, Text, Ontologieidentität und eigene Suchereignisse, aber keine verborgenen Eingabeannotationen oder fremden Entscheidungen. Reviewexport erhält zusätzlich die referenzierten Originalvorschläge. Beide erhalten neue Paketidentitäten; fehlende Referenzen sind ein Exportfehler. Test prüft verborgene Vorschläge auch im entpackten Independent-Export.
- [ ] Tests bestehen, einschließlich fehlender Evidenzreferenzen, Copy-on-write und unabhängiger zweiter Person. Commit: `feat: implement origin-neutral annotation and review`.

## Aufgabe 7: Lokale API und generierte Browserverträge

**Dateien:** `api/*.py`, `config.py`, `cli.py`, `scripts/export_openapi.py`, `contracts/openapi.json`, `frontend/src/api/{generated,client}.ts`, `tests/test_api.py`.

**Schnittstellen:** `create_app(config: AppConfig) -> FastAPI`; CLI `hpo-editor serve --workspace PATH --ontology PATH --port 0`. Routen unter `/api/v1`: `POST /packages`, `GET /packages`, `GET /packages/{id}/documents`, `POST /workspaces/review-inputs`, `POST /workspaces/open`, `POST /workspaces/{id}/commands`, `POST /workspaces/{id}/decisions`, `POST /workspaces/{id}/submit`, `GET /workspaces/{id}/submissions/{submission_id}`, `POST /search`, `GET /workspaces/{id}/export`. Workspace-Mutationen enthalten `MutationEnvelope`; Upload nutzt begrenzten ZIP-Body, keine vom Browser gelieferten Serverpfade. Paket- und Dokumentübersichten zeigen vor der Moduswahl ausschließlich Dokumentmetadaten, keine Vorschlagszahlen oder Herkunftshinweise. `review-inputs` verlangt expliziten Reviewkontext (Paket, Dokument, Annotierende, `mode=review`) und liefert auswählbare Versionen; Independent-Aufrufe werden abgewiesen. `open` erhält die gewählte Zielmenge, prüft deren Hash, und gibt eine opake Workspace-ID zurück.

- [ ] API-Tests für vollständigen Paket→Review→Export-Ablauf, 409 bei veralteter Revision, 422 bei fachlichen Fehlern und gleiche Responses für beide Herkunftsarten schreiben. Independent-Responses auf Vorschlagstexte, IDs, Counts und maschinelle Einschätzungen prüfen: diese fehlen auch in Dokumentübersicht und Fehlerdetails.
- [ ] Alte Abgabe nach späterer Bearbeitung über den Workspace-Endpunkt öffnen: unveränderter alter Stand, keine fremden Workspaces. Commit mit verlorener Response für Edits, Entscheidungen und Abschluss wiederholen; jeweils exakt ein Effekt und gleiche Antwort. Wiederholten Abschluss darf keine zweite Abgabe erzeugen.
- [ ] `uv run pytest tests/test_api.py -q` ausführen und Fehlschlag prüfen.
- [ ] Services anbinden; unabhängige Workspaces dürfen keine Eingabeversionen über erratene IDs lesen und Reviewrouten nicht verwenden. Kein allgemeiner Snapshot-Endpunkt ohne Workspace- oder expliziten Review-Einrichtungskontext. Die Anwendung ist keine Sicherheitsgrenze gegen Personen mit lokalem Dateizugriff.
- [ ] Nur auf `127.0.0.1` binden; Launcher erzeugt zufälliges Sitzungstoken, übergibt es im URL-Fragment, UI entfernt Fragment und sendet Authorization-Header. Token nicht protokollieren. Origin und Host gegen tatsächlichen lokalen Port prüfen; fremde Origins, falsche Tokens und DNS-Rebinding-Hosts testen. Gleiches Origin für gebaute Oberfläche und API, kein pauschales CORS.
- [ ] OpenAPI ohne echte Datenbank/Ontologie exportieren. `npm run api:generate` erzeugt TS-Typen aus `../contracts/openapi.json`; `npm run api:check` erkennt Abweichungen ohne Dateien umzuschreiben. Typisierte Fetch-Hülle behandelt 409/422 und Speicherfehler, Server validiert jeden Request.
- [ ] API-Tests und `npm run typecheck` bestehen. Commit: `feat: expose secured local editor API`.

## Aufgabe 8: Fallansicht, Suche und unabhängige Annotation

**Dateien:** Vite-/React-Einstieg, `app/*.tsx`, `editor/{TextPane,AnnotationPanel,SearchPanel}.tsx`, `editor/searchState.ts`, `styles.css`, `tests/searchState.test.ts`, `tests/e2e/annotation.spec.ts`.

**Schnittstellen:** Verwendet API-Client und SpanEditorHandle. `CaseScreen` besitzt genau einen geladenen WorkspaceView; SpanAdapter rendert Evidenz, API bleibt autoritativ. `SearchPanel` meldet ausgewählte Term-ID und Suchereignis-ID.

- [ ] Vor UI-Arbeit den Impeccable-Skill anwenden, Produkt-/Designkontext für diese Arbeitsoberfläche aufnehmen. Deutsche Bedientexte, klare Tastaturfokusse, Fallliste/Text/Detailbereich; auf schmalem Bildschirm umschaltbare Bereiche statt abgeschnittener Inhalte. Keine klinischen Standardwerte vorauswählen.
- [ ] Browser-Test schreiben: Paket importieren, unabhängigen Modus öffnen, Text markieren, Term finden, Kontext setzen, zweite Erwähnung ergänzen; außerdem ausdrückliche spanlose Anlage. Verzögerte Suche A nach Suche B darf B nicht ersetzen; Suche mit leerer Query zeigt keine alten Kandidaten.
- [ ] In `frontend`: `npm run test:e2e -- annotation.spec.ts` und `npm test -- --run tests/searchState.test.ts` ausführen; fehlende Oberfläche ist erwartete Fehlerursache.
- [ ] Fall-/Paketwahl, lokale Identität, Moduswahl, Textansicht, Suchwege und ausgewählte Annotation implementieren. Erst nach Wahl von Review die verfügbaren Eingabeversionen anzeigen und die konkrete Zielmenge bestätigen lassen; gleiche Auswahlregeln für alle Quellen. Stable ID beim Start einer Annotation erzeugen und auch für Suchseed verwenden. Kontextfelder aus `/workspaces/open`-Achsendefinition rendern. Aktive Annotation/Evidenz deutlich anzeigen; Aktionen „Weitere Belegstelle“ und „Weiteres Segment“ unterscheiden wiederholte von unterbrochener Erwähnung. Status nicht nur durch Farbe vermitteln.
- [ ] `AbortController` plus Request-ID schützt Suche vor veralteten Ergebnissen. Warnung für Eltern-/Kindpaare darstellen, ohne Terme zu entfernen; obsolete Einträge sichtbar, nicht neu auswählbar. Spanlose Einträge kennzeichnen und Ergänzen von Evidenz ermöglichen.
- [ ] Tests und Typecheck bestehen; Commit: `feat: add local annotation workspace UI`.

## Aufgabe 9: Reviewoberfläche, Autosave und Abschluss

**Dateien:** `editor/{ReviewActions,AnnotationPanel}.tsx`, `editor/autosave.ts`, `app/CaseScreen.tsx`, `tests/autosave.test.ts`, `tests/e2e/review.spec.ts`.

**Schnittstellen:** `createMutationQueue(sendMutation, onState)` liefert `enqueue`, `flush`, `dispose`; Zustände `dirty | saving | saved | error | conflict`. Eine gemeinsame Queue pro Workspace serialisiert EditCommands, Reviewentscheidungen und Abschluss. Sie aktualisiert Revision erst nach bestätigtem Response und hält fehlgeschlagene Änderungen für Retry. Gegenfassungsreferenzen werden erst beim ersten Dispatch der Entscheidung aus dem zuletzt bestätigten Snapshot aufgelöst, nachdem davor eingereihte Edits gespeichert sind. Dann werden Mutation-ID, Revision und Payload für alle Retries eingefroren. Abschluss läuft ebenfalls durch diese Queue.

- [ ] Tests schreiben: gleiche Buttons/Transitions bei Human-/Tool-Provenienz, unverändertes Original nach Gegenfassung, unsicher getrennt von klinisch uncertain, zweite Browseransicht verursacht sichtbaren Konflikt. Autosave-Test injiziert 500 nach Edit 1 und vor Edit 2: weder „gespeichert“ noch Verlust der ausstehenden Änderungen. Verzögerten Edit unmittelbar gefolgt von „Ändern bestätigen“ und Abschluss testen: kein selbst verursachter 409, Entscheidung referenziert den tatsächlich gespeicherten Ersatzstand.
- [ ] Transportfehler nach erfolgreichem Commit im Queue-Test simulieren; Retry verwendet unveränderten Envelope, übernimmt gespeicherten Receipt und verarbeitet Edit 2 anschließend genau einmal. Das UI verwechselt dies nicht mit einem echten konkurrierenden Write.
- [ ] `npm test -- --run tests/autosave.test.ts` und `npm run test:e2e -- review.spec.ts` ausführen und Fehlschlag prüfen.
- [ ] Bestätigen/Verwerfen/Ändern/Unsicher und Ergänzen implementieren. Bei Ändern Gegenfassung klar vom Original unterscheiden; Provenienz als Detail anzeigen, nicht als abweichenden Workflow. Vorhandene Herkunftseinschätzungen erhalten, keine menschliche oder maschinelle Quelle automatisch höher gewichten.
- [ ] Autosavequeue integrieren. Bei Konflikt lokale Änderungen sichtbar erhalten, erneutes Laden mit ausdrücklichem Verwerfen anbieten; kein blindes Retry mit neuer Revision. Navigation bei ausstehenden Änderungen blockieren oder bestätigten Verzicht verlangen. UI verspricht keine Wiederherstellung ungespeicherter Änderungen nach Browserabsturz.
- [ ] Abschluss mit expliziter Vollständigkeitsbestätigung, offenen Entscheidungen und Null-Befund-Fall implementieren. Frühere Abgabe über den Workspace-Endpunkt schreibgeschützt anzeigen, Fortsetzen als Entwurf und Export in eine neue Datei anbieten; unsichere Ergebnisse sichtbar halten.
- [ ] Tests bestehen; Tastaturbedienung der vier Reviewaktionen prüfen. Commit: `feat: add review workflow and reliable autosave`.

## Aufgabe 10: Auslieferbares lokales Paket und durchgängige Abnahme

**Dateien:** `scripts/build_release.py`, Paketkonfiguration, `README.md`, `.github/workflows/ci.yml`, `tests/test_release.py`, `frontend/tests/e2e/release.spec.ts`.

**Schnittstellen:** `uv run python scripts/build_release.py` baut mit `npm ci` die Oberfläche, kopiert nur Build-Assets nach `src/hpo_editor/web/` und erstellt das Wheel. `hpo-editor serve` liefert diese Assets per Same-Origin aus. Anwender installieren das Wheel in eine Python-/uv-Umgebung; kein Node und kein Vite-Server zur Laufzeit.

- [ ] Release-Test in sauberer Umgebung schreiben: Wheel installieren, synthetische Ontologie/Paket bereitstellen, Dienst starten, Review durchführen, neu starten und Paket exportieren. Text, Provenienz, Entscheidungen, gruppierte Evidenz und Suchereignisse müssen den Rundlauf bestehen; Abgabehashes bleiben gleich.
- [ ] Release-Test vor Assetintegration ausführen und erwarteten Fehler prüfen. Synthetische Offline-Abnahme darf keine Downloads oder Dienste anstoßen.
- [ ] Build und Startbefehl implementieren, Fehlermeldungen für belegten Port, fehlende Assets, falsche Ontologie und neuere DB-Version ergänzen. Windows-Pfade mit Leerzeichen testen. README beschreibt Installation, Backup bei geschlossenem Dienst, Datenpfad, Ein-/Ausgabeformat und fehlenden Goldexport.
- [ ] CI führt Backendtests, Ruff, mypy, Typecheck, Vitest, API-Driftprüfung, Frontendbuild und Playwright aus. Offline bezieht sich auf Tests nach Installation der gepinnten Dependencies/Browser. Mindestens Windows und Linux für Backend-/Paketrundlauf; Chromium für den vollständigen UI-Ablauf.
- [ ] Verifikation: `uv run pytest -q`, `uv run ruff check .`, `uv run mypy src/hpo_editor`; in `frontend`: `npm run typecheck`, `npm run api:check`, `npm test -- --run`, `npm run build`, `npm run test:e2e`. Erwartet: alle erfolgreich, kein Netzwerkzugriff während Offline-Fällen.
- [ ] Eine gebündelte visuelle Prüfung auf Desktop und schmaler Ansicht, anschließend gezielte Korrekturen. Abnahmekriterien 1–12 der Spezifikation den Testfällen zuordnen und dokumentieren. Commit: `build: package and verify offline editor release`.

## Abschluss und anschließender Pilot

Ergebnis ist ein lokal installierbarer Editor mit synthetisch geprüfter Herkunftsunabhängigkeit und verlustfreiem Paketaustausch. Kein externer Push, keine Veröffentlichung und kein reales Datenpaket sind Bestandteil dieses Planungsauftrags.

Nach technischer Abnahme: eigener Plan für den Export eines echten E3C-Arbeitspakets aus der Benchmark-Pipeline und einen ärztlichen Probelauf. Erkenntnisse daraus fließen vor größerer Annotation in den Editor ein. Schema-/Goldfreigabe und Mehrpersonen-Reconciliation bleiben getrennte Aufgaben.

Empfohlene Umsetzung: direkt in einer Sitzung, Aufgaben in dieser Reihenfolge, gezielte Überprüfung nach jedem funktionalen Schritt. Die gemeinsamen Domänenverträge und die abhängigen UI-Abläufe machen eine breite parallele Implementierung zunächst wenig hilfreich.

## Technische Referenzen

FastAPI unterstützt Pydantic-Validierung und OpenAPI-Erzeugung: [offizielle Features](https://fastapi.tiangolo.com/features/).
Die gebaute Oberfläche kann in ein bestehendes Backend integriert werden: [Vite Backend Integration](https://vite.dev/guide/backend-integration).
Generierte TypeScript-Typen sind statisch und ersetzen keine Laufzeitvalidierung: [openapi-typescript](https://openapi-ts.dev/).

Lokale Wiederverwendungsgrundlage: `hpo-span-annotator` bei `27c5dad`, insbesondere `hpo.py`, `lexical.py`, `search.py`, `ui/spans.js` und deren Tests. Diese Quellen wurden für die Planung gelesen; neue Editorfunktionen und deren Tests wurden noch nicht ausgeführt.

## Agentisches Planreview vom 2026-10-01

Zwei unabhängige Agenten prüften Domänen-/Austauschverträge beziehungsweise technische Umsetzbarkeit und Tests. Sie meldeten sieben konkrete Lücken; nach Abgleich wurden sie im Plan und, soweit fachlich relevant, in der Spezifikation korrigiert:

| Befund | Ergänzung | Aufgaben |
|---|---|---|
| Historische Evidenzstände unter gleicher ID nicht eindeutig | Versionierte Evidenzreferenzen, zusammengesetzte Schlüssel | 1–3 |
| Export verändert Paketidentität, Abgabe darf sich nicht ändern | Historische Herkunft getrennt von lokaler Importbindung | 2, 3, 6 |
| Revieweingaben nicht dauerhaft ausgewählt | Unveränderliche gehashte Zielmenge je Reviewrunde | 1, 6–9 |
| Edit und Reviewentscheidung können im selben Tab kollidieren | Gemeinsame Mutationsqueue, spätes Binden der Ersatzversion | 6, 7, 9 |
| Neue Erwähnung und weiteres Segment im Adapter unklar | Explizite Auswahlabsicht und Evidenzauswahl | 5, 8 |
| Frühere Abgabe ohne dokumentierten Leseweg | Workspacegebundener Leseendpunkt und schreibgeschützte Ansicht | 6, 7, 9 |
| Erfolgreicher Write mit verlorener Antwort nicht sicher wiederholbar | Stabile Mutations-ID und transaktionaler Receipt | 3, 6, 7, 9 |

Beide Agenten bestätigten anschließend die Behebung ihrer Befunde und fanden in der gezielten Nachprüfung keine durch die Korrekturen eingeführten Widersprüche. Dies ist eine Prüfung des Plans, keine Verifikation einer Implementierung; Anwendungstests wurden nicht ausgeführt.
