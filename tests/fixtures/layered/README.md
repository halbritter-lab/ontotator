# Layered Fixtures and Single-Layer Baseline Acceptance

## 1. Bestehende Pflichtbedienfolge (Ein-Schicht-Referenz)

Der bestehende Ablauf für Ein-Schicht-Pakete (HPO) definiert die Obergrenze für Pflichtinteraktionen. Das neue Schichtensystem darf für Ein-Schicht-Pakete **keine zusätzlichen Auswahlschritte, Dialoge oder Bestätigungen** einführen.

### A. Unabhängige Annotation (Independent Mode)
1. **Paket & Arbeitsbereich öffnen:**
   - Paket auswählen (falls mehrere vorhanden; sonst vorselektiert)
   - Annotator-ID eingeben
   - Modus auswählen (`independent`)
   - Klick auf `Arbeitsbereich öffnen`
2. **Annotation anlegen (mit Evidenz):**
   - Textabschnitt mit der Maus/Tastatur im Textbereich markieren
   - Term im Suchfeld eingeben und Ergebnis auswählen
   - Optionale Achsenwerte setzen (oder Standard belassen)
   - *Alternative (spanlos):* Klick auf `+ Spanlose Annotation`, Begriff in Ontologie suchen und auswählen
3. **Abschluss:**
   - Checkbox `Dokument vollständig geprüft` aktivieren
   - Klick auf `Fall abschließen`
   - *Null-Befund:* Auch ohne angelegte Annotationen ist das Aktivieren der Checkbox und der Abschluss möglich.

### B. Review-Ablauf (Review Mode)
1. **Paket & Arbeitsbereich öffnen:**
   - Modus `review` auswählen, `Arbeitsbereich öffnen`
2. **Vorschlag prüfen:**
   - Ersten Vorschlag aus der Liste wählen (oder automatisch aktiv)
   - Eine von vier Aktionen wählen:
     - `✓ Bestätigen`
     - `✗ Ablehnen`
     - `Korrektur` (Achsen anpassen oder Term/Beleg ersetzen)
     - `Zurückstellen`
3. **Abschluss:**
   - Sobald alle Review-Ziele entschieden sind: Checkbox `Dokument vollständig geprüft` aktivieren
   - Klick auf `Fall abschließen`
   - Paket-Download / Export auslösen

---

## 2. Synthetische Abnahmeszenarien A / B / C

### Szenario A: Single-Layer HPO (Regressionssicherheit)
- **Ontologie:** Genau 1 Ontologie (`HP`, Human Phenotype Ontology).
- **Schichten:** Genau 1 editierbare Schicht (`hpo-layer`), Default-Schicht.
- **Typen:** Genau 1 Annotationstyp (`phenotype`), Default-Typ.
- **UI-Garantie:** Keine Schicht- oder Typauswahl sichtbar. Null zusätzliche Klicks gegenüber dem bisherigen Ablauf.

### Szenario B: Assisted / Zweite Ontologie (Quellschicht + Zielschicht)
- **Ontologien:** 2 Ontologien (z. B. Quell-Ontologie `MONDO` oder `HP`, Ziel-Ontologie `ORPHA` oder `HP`).
- **Schichten:**
  - 1 Referenzschicht (`reference-layer`, `access: "reference"`): schreibgeschützt, sichtbar als Kontext.
  - 1 Zielschicht (`target-layer`, `access: "editable"`): editierbar, Default-Schicht.
- **Modus:** `assisted` oder `review`.
- **Garantien:**
  - Unabhängige Evidenz: Änderungen am Ziel lassen Quell-Snapshots unberührt (Copy-on-Write).
  - Keine Mappingpflicht, keine 1:1-Zuordnung erzwungen.
  - Ausblenden der Referenzschicht ändert weder Abschlussumfang noch Exportumfang.

### Szenario C: Multi-Editable (Zwei bearbeitbare Schichten, unterschiedliche Regeln)
- **Ontologien:** 2 Ontologien mit potenziell überlappenden Term-IDs (z. B. `HP` und synthetische Zweitontologie `EXT`).
- **Schichten:**
  - Schicht 1 (`layer-1`, `access: "editable"`, Typ mit optionaler Evidenz).
  - Schicht 2 (`layer-2`, `access: "editable"`, Typ mit `evidence_policy: "required_on_complete"`).
- **Garantien:**
  - Schalter zur getrennten Steuerung von Sichtbarkeit und aktiver editierbarer Schicht.
  - Beide Schichten müssen vor dem Abschluss geprüft sein (`checked_layer_ids`).
  - Pflichtregeln (z. B. Evidenzpflicht) werden beim Abschluss für jede Schicht separat durchgesetzt.
