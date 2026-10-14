<!-- Original read-only Claude Code review before the documented correction pass. -->

# Code-Review: ontospan @ `52fb89a` (Tasks 1–12)

**Ergebnis: in diesem Stand nicht merge-bereit.** Es gibt keinen Critical-Befund, aber sechs Important-Befunde. Fast alle betreffen die Schwerpunkte des Auftrags: Minor-Kompatibilität, Behandlung fehlerhafter Daten, Warnungen beim Lesen und Phenopacket-Gruppierung. Jeder lässt sich lokal beheben. Nach Behebung von I1–I6 samt Regressionstests ist der Branch merge-fähig.

**Geprüft:** alle Module unter `src/ontospan`, die Schemas, das README, `conformance/`, die Tests zu Bundles, Validierung, Matching, Phenopacket und Konformanz sowie Spec, Plan-Review und Ledger.

**Wie geprüft:** Jede Reproduktion unten habe ich selbst mit `.venv` (Python 3.12.13) ausgeführt, rein im Speicher und ohne Dateien zu schreiben. Die Hungarian-Methode habe ich zusätzlich in 3000 Zufallsfällen gegen Brute Force geprüft: keine Abweichung.

## Critical

Keine.

## Important

### I1: Lone Surrogates bringen `validate()`, `load_annotated_document()` und `read_bundle()` zum Absturz
- **Wo:** `text.py:19-20`, `validate.py:199`, `validate.py:298`, `bundle.py:215-221`
- **Problem:** `json.loads` akzeptiert `"\ud800"`. Danach wirft `text_sha256()` beim UTF-8-Encode eine `UnicodeEncodeError`. Das widerspricht der Zusage „nothing is raised“ und dem `FormatError`-Vertrag aus T1-4. `read_bundle` fängt nur `FormatError` ab, also bricht ein einziges präpariertes Dokument das Lesen des ganzen Bundles ohne Bericht ab. Dasselbe gilt für Surrogates in `segment.text` und in unbekannten Feldern beim `dump_json`.
- **Reproduktion:** `d = sample().model_dump(mode="json"); d["document"]["text"] += "\ud800"; validate(d)` → `UnicodeEncodeError`.
- **Fix:**
  - In `_parse` vor dem Schema-Check alle Strings rekursiv auf Surrogates prüfen und als Issue melden, z. B. `invalid_unicode`.
  - Zusätzlich in `read_bundle` pro Datei unerwartete Ausnahmen in Issues übersetzen.
  - Einen Konformanzfall ergänzen.

### I2: Bundles aus Units einer neueren Minor-Version sind nicht wieder lesbar
- **Wo:** `bundle.py:92-102` mit `bundle.py:163-166`
- **Problem:** Das Manifest bekommt immer den Default `schema_version="1.0.0"`, übernimmt aber die Layer der Units samt unbekannten Feldern. Der Reader prüft das Manifest dann streng gegen das 1.0-Schema. Das verletzt D2: Units werden gelesen, geschrieben und können dann vom selben Paket nicht mehr gelesen werden.
- **Reproduktion:**
  - Ausgangspunkt ist eine Unit mit `schema_version` 1.1.0 und `layers[0]["term_set"]="r0"`.
  - `write_bundle` läuft durch.
  - `read_bundle` meldet `schema` mit „Additional properties are not allowed ('term_set' …)“ auf `layers.0`.
- **Fix:**
  - `schema_version` des Manifests auf das Maximum der Unit-Versionen setzen, mindestens aber `SCHEMA_VERSION`.
  - Alternativ Units mit unbekannten Layer-Feldern beim Schreiben mit klarer Meldung ablehnen.
  - Einen Round-Trip-Test für ein Bundle mit 1.1-Units ergänzen.

### I3: Bei einer neueren Minor-Version prüft der Reader die bekannten Felder gar nicht strukturell
- **Wo:** `validate.py:89-90`, `validate.py:112-113`
- **Problem:** Für eine neuere Minor-Version wird der Schema-Check komplett übersprungen. Pydantic im Lax-Modus korrigiert dann stillschweigend falsche Typen, und die Werte werden verändert zurückgeschrieben. Eine Unit, die als `1.0.0` vier `schema`-Fehler hat, ist schon dadurch fehlerfrei, dass sie `1.1.0` deklariert. F3/D2 verlangen aber nur, *unbekannte Felder* zu tolerieren.
- **Reproduktion:** In einer `1.1.0`-Unit `blind="yes"`, `start="6"`, `document_level="false"` und `created_at=1760443200` setzen. Ergebnis: nur die Warnungen `newer_minor` und `hierarchy_not_checked`. Geladen wird `blind=True` und `created_at=2025-10-14T12:00:00+00:00`.
- **Fix:**
  - Gegen das neueste mitgelieferte Schema prüfen, dabei `additionalProperties` gelockert (Kopie des Schemas ohne `_close`).
  - Zusätzlich `model_validate(..., strict=True)` verwenden.

### I4: Warnungen gehen beim Lesen verloren, auch die zur Ontologie-Version
- **Wo:** `validate.py:289-292`, `bundle.py:186-229`
- **Problem:** `load_annotated_document` und `read_bundle` werfen den Bericht weg, sobald er keine Fehler enthält. Dadurch sieht man nie:
  - `newer_minor` und `unknown_profile` (D2: „accept *with warnings*“),
  - `ontology_release_mismatch` (T1-14),
  - `cohort_frequency` (F5),
  - `empty_after_normalization` und `hierarchy_not_checked`.

  Ausgerechnet der Haupt-Lesepfad für Releases und Benchmark meldet also eine falsche HPO-Version nicht.
- **Reproduktion:** Ein Bundle mit Layer-Version `2019-01-01` an `read_bundle(m, {"hp": hp})` übergeben, wobei `hp.release == "2026-06-23"`. Es kommt nur `(Manifest, [unit])` zurück, ohne jeden Hinweis. `validate()` dagegen meldet für dieselbe Unit `['ontology_release_mismatch']`.
- **Fix:**
  - `read_bundle` gibt den `ValidationReport` mit zurück, oder es gibt ein Ergebnisobjekt mit `.warnings`.
  - Pfade der Unit-Warnungen mit dem Dateipfad präfixen.
  - `load_annotated_document` bekommt dieselbe Möglichkeit, etwa als optionalen Rückgabewert oder Parameter `report=`.

### I5: Die JSON-Schemas machen `schema_version` und `artifact_type` optional, der Validator verlangt `schema_version` aber
- **Wo:** `models.py:136-137` und `154-155`, `schema_export.py:46`
- **Problem:** Das Schema ist laut F12 der bindende Vertrag für Phentrieve. Weil Pydantic Felder mit Default nicht als `required` exportiert, divergieren Schema und Validator: Ein schemakonformes Dokument wird von ontospan abgelehnt.
- **Reproduktion:**
  - `schema_version` und `artifact_type` aus `sample()` löschen.
  - Das Schema `annotated-document-1.0.json` meldet keinen Fehler.
  - `validate()` meldet den Fehler `schema_version`.
- **Fix:**
  - Beide Felder in beiden Modellen im Schema als `required` exportieren, z. B. per `json_schema_extra`, oder sie in `_model_schema` nachtragen.
  - `artifact_type` als `const` ist schon da.
  - Einen Konformanzfall „fehlende `schema_version`“ ergänzen.
  - Hinweis: Das ändert die eingefrorene Datei 1.0. Weil noch nichts veröffentlicht ist (Task 13 ausgenommen), ist das jetzt noch zulässig.

### I6: Phenopacket-Export vermischt mehrere Annotation-Sets desselben Dokuments, und der Default widerspricht F9
- **Wo:** `phenopacket.py:216-260`, vor allem `220` und `246-248`
- **Problem 1, Default:** F9 sagt „by default one Phenopacket per document. Optionally … combined“. Der Code nimmt aber `group_by_subject=True` als Default, übernommen aus dem Plan.
- **Problem 2, Vermischung:** Ein Bundle enthält laut F3 bewusst mehrere Sets pro Text (Annotator A, Annotator B, Adjudikation).
  - Gruppiert werden alle Sets eines Subjects zu einem Packet zusammengeführt, mit doppelten oder widersprüchlichen Features.
  - Ungruppiert bekommen alle Packets die `document_id` als ID, und die kollidiert.
- **Reproduktion:** Zwei Sets A und B auf `doc-1` mit `subject_id="P1"`:
  - gruppiert: `[('P1', 2)]`, also zwei identische Features;
  - ungruppiert: IDs `['doc-1', 'doc-1']`.
- **Fix:**
  - Default auf `False` setzen, wie in der Spec.
  - Die ungruppierte Packet-ID eindeutig machen, z. B. `document_id` plus `annotation_set_id` oder `annotation_ref`-artig.
  - Mehrere Sets mit gleichem `text_sha256` bzw. gleicher `document_id` in einer Gruppe erkennen und entweder ablehnen oder im `ExportReport` melden. Den Aufrufer-Vertrag („pro Dokument genau ein Set übergeben, z. B. `adjudicated`/`release`“) dokumentieren.

## Minor

1. **Hochgestellte Ziffern in der Version** (`validate.py:67-71`): `"².0.0"` besteht `isdigit()`, aber `int()` wirft `ValueError`. Damit stürzt `validate()` ab. Volle-Breite-Ziffern wie `"１.０.０"` werden akzeptiert und so zurückgeschrieben. Das gilt auch für `models.py:24` und die Schema-Patterns, weil `\d` dort Unicode-Ziffern matcht. Fix: `[0-9]` und `str.isascii()`.
2. **Rohe Ausnahmen beim ZIP-Lesen** (`bundle.py:134-148`, `191-194`): Kaputte, verschlüsselte oder fehlende ZIPs werfen `BadZipFile`, `RuntimeError` oder `zlib.error` statt `FormatError`. Reproduziert mit `b"PK\x03\x04garbage"` → `BadZipFile`.
3. **`canonical_text` ist nicht idempotent** (`text.py:15`): `removeprefix` entfernt nur ein BOM. `make_document("x","de","\ufeff\ufeffabc")` erzeugt ein Dokument, das der Validator als `text_not_canonical` ablehnt (reproduziert). Fix: alle führenden U+FEFF entfernen oder im Validator konsistent prüfen.
4. **Doppelte JSON-Schlüssel** (`validate.py:286`, `bundle.py:156`): Bei doppelten Schlüsseln gewinnt still der letzte (reproduziert). Fix: `object_pairs_hook`, der Duplikate als Issue meldet. Das Thema ist sicherheitsnah, weil verschiedene Parser unterschiedlich interpretieren.
5. **Mehrere `hp`-Ressourcen mit derselben ID** (`phenopacket.py:136-155`): Ein gruppiertes Packet mit zwei HPO-Releases enthält zwei Ressourcen mit `id="hp"` (reproduziert). Außerdem wird nicht geprüft, ob das übergebene `ontology.release` zur Layer-Version passt (Labels aus fremdem Release).
6. **Fremde Dateien im Verzeichnis** (`bundle.py:119-126`, `208-209`): `.DS_Store`, `Thumbs.db` usw. in Verzeichnis-Bundles werden zu `unlisted_file`-Fehlern. Gelistete Dateien außerhalb von `documents/` werden als Units geladen. F3 sieht aber `documents/*.json` vor.
7. **`.ZIP` wird zum Verzeichnis** (`bundle.py:104`): `target.suffix == ".zip"` unterscheidet Groß-/Kleinschreibung, `out.ZIP` wird daher ein Verzeichnis.
8. **Symlinks auf Windows ungetestet** (`tests/test_bundle.py:92-100`): Der Symlink-Test wird auf Windows immer übersprungen. Junctions brauchen keine Rechte und gehen in `_read_directory` dank `resolve()` vermutlich in `unsafe_path`. Das ist nur hergeleitet, nicht getestet. Fix: ein Junction-Test mit `mklink /J`.
9. **Matching-Laufzeit wächst kubisch** (`matching.py:194-213`, `241-246`, `95-96`): Hungarian plus `_covered` pro Paar über die ganze Matrix. Gemessen: 150 Annotationen pro Seite 0,8 s, 300 pro Seite 5,6 s. Für Live-Agreement bei großen Dokumenten spürbar. Fix: in Zusammenhangskomponenten überlappender Annotationen zerlegen und die Keys vorberechnen.
10. **Referenzen ohne kanonische Form** (`refs.py:35`): Durch das lockere `unquote` haben Referenzen keine kanonische Form (`%3A` und `%3a`, ungültige `%zz` und Leer-Teile aus Leerzeichen werden alle akzeptiert). Außerdem wird nicht geprüft, ob `source_refs` auf existierende Annotationen zeigen. Die Spec schweigt dazu; das sollte zumindest dokumentiert werden.
11. **Ordnungsprüfung nach Bereichsfehler unvollständig** (`validate.py:131-134`): Nach `segment_out_of_range` wird `previous_end` nicht fortgeschrieben, sodass eine Fehlordnung danach unentdeckt bleibt (nur bei ohnehin fehlerhaften Daten).
12. **`allowed_roots` und Manifest-Version** (`models.py:109`): `allowed_roots` hat kein CURIE-Pattern, und es wird nicht geprüft, ob die Wurzeln in der Ontologie existieren. Ein Tippfehler macht jede Annotation zu `outside_allowed_roots`. Ebenso wird nicht geprüft, ob die Manifest-Version zu den Units passt.
13. **Lücken in der Konformanz** (`conformance/`): Fixtures fehlen für `model`-Fehler (`end <= start`, Längenabweichung), `duplicate_layer`, `duplicate_annotation` und Bundle- bzw. Manifest-Fälle. Externe Implementierungen haben dafür keinen bindenden Erwartungswert.

## Positiv geprüft
- Die optimale Zuordnung ist korrekt: Brute-Force-Vergleich und die lexikografische Gewichtung (`base**level * scale + shared`) habe ich nachgerechnet.
- Paarung pro Layer, D3 (Dokument-Ebene vs. Mention = `compatible`) und Rückgabe in Textreihenfolge stimmen.
- Agreement wird getrennt auf Annotation-, Mention- und Term-Ebene berechnet, jeweils strikt und tolerant.
- Unbekannte Felder bleiben im Round-Trip einer einzelnen Unit erhalten.
- ZIP-Duplikate, `..`, Backslash-Pfade und Größenlimit werden vor dem Lesen geprüft. `file_size` wird von `zipfile` tatsächlich durchgesetzt.
- Die CRLF-Diagnose funktioniert. `.gitattributes` ist vorhanden.

## Bewusst nicht beurteilt
- Ob das Label zu `ECO:0007636` korrekt ist; die Spec legt nur die ID fest.
- Ob `historical`-Befunde überhaupt exportiert werden sollten. Die Spec verlangt nur, sie im Report zu zählen, und das ist erfüllt.
- Ob `ontology_release_mismatch` Warnung oder Fehler sein sollte. Die Spec sagt nur „reports“; die Warnung ist vertretbar, das Problem ist I4.
- TOCTOU zwischen Symlink-Prüfung und Lesen bei Verzeichnis-Bundles.
- `ObographOntology` gegen ein echtes `hp.json`, z. B. Knoten ohne `type`; geprüft habe ich nur die Mini-Fixture.
- Strukturelles Parsen mit der `phenopackets`-Bibliothek habe ich nicht ausgeführt.
- Die Testsuite, ruff, mypy, Schema-Drift und Build habe ich nicht erneut laufen lassen; das prüft der Koordinator.
- Task 13 (Veröffentlichung) ist ausgenommen.
