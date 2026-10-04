# Design: Standalone-Paketierung und Zero-CLI Konfiguration

**Datum:** 2026-10-04  
**Status:** Entwurf zur Prüfung  
**Thema:** Standalone-Verteilung ohne Installation, persistente Konfiguration und Dateihandling ohne Kommandozeile

---

## 1. Ziel und Umfang

Ontocurator soll als **vollständig portables Standalone-Paket** verteilt werden können. Zielgruppe sind u. a. klinische Curation-Teams und Annotatoren, die auf Dienst-PCs arbeiten und über keine Entwicklertools (weder Python noch Node.js) und typischerweise keine Administratorrechte verfügen.

### Kernanforderungen:
1. **Keine Installation (Portable Distribution):** Auslieferung als ZIP-Archiv. Entpacken und Starten per Doppelklick ohne Setup-Assistent, ohne Registry-Änderungen und ohne Admin-Rechte.
2. **Zero-CLI-Start:** Start ohne Konsolenparameter öffnet automatisch den Standardbrowser mit der Anwendung.
3. **Persistente Konfiguration:** Speicherung der gewählten Einstellungen (Workspace-Pfad, geladene Ontologien, Port, etc.) über Programm- und Rechnerneustarts hinweg.
4. **SOTA-Dateihandling ohne Kommandozeile:** 
   - **Auto-Discovery:** Automatisches Erkennen und Laden von Ontologie-Dateien (`hp.json`, `mondo.json`) in einem Standardordner (`<workspace>/ontologies/`).
   - **In-App Management & Upload:** Verwaltung und Upload von Ontologien direkt über die Web-Oberfläche (`GET /api/v1/ontologies`, `POST /api/v1/ontologies`), inklusive nahtloser Aufforderung zum Upload, falls einem importierten Work Package eine Ontologie fehlt.
   - **Sicheres Startargument-Handling:** Falls dem Binary beim Start ein Dateipfad übergeben wird (z. B. Drag & Drop auf die Executable oder "Öffnen mit"), wird die Datei sicher interpretiert (`.zip` als Paket, `.json` als Ontologie, Ordner als Workspace) – ohne Absturzrisiko bei unbekannten Eingaben.
5. **Lokale Build-Pipeline:** Ein Skript `scripts/build_standalone.py` auf Basis von PyInstaller; vorerst ohne CI/CD-Workflow.

---

## 2. Persistente Konfiguration (`ontocurator.config`)

Bislang liest `ontocurator serve` Einstellungen ausschließlich aus CLI-Flags und Umgebungswerten. Neu eingeführt wird ein strukturierter Konfigurationsmechanismus:

### Speicherorte (Reihenfolge der Priorität):
1. **CLI-Argumente:** Explizite Flags (`--workspace`, `--ontology`, etc.) überschreiben persistierte Werte.
2. **Lokaler Workspace-Override:** `<workspace>/config.json` (falls vorhanden).
3. **OS-Benutzerkonfiguration:** Standardmäßiges Konfigurationsverzeichnis des Betriebssystems:
   - Windows: `%APPDATA%\ontocurator\config.json`
   - macOS: `~/Library/Application Support/ontocurator/config.json`
   - Linux: `~/.config/ontocurator/config.json`
4. **Defaults:** Fallback auf `./workspace`, Port 8000, Loopback 127.0.0.1.

### Datenmodell `PersistentConfig`:
```python
class PersistentConfig(BaseModel):
    workspace_dir: Path = Path("./workspace")
    ontology_paths: list[Path] = Field(default_factory=list)
    port: int = 8000
    host: str = "127.0.0.1"
    auto_open_browser: bool = True
```

### Verhalten beim Start:
* Beim Programmstart wird die Benutzerkonfiguration geladen (oder mit Standardwerten initialisiert).
* Der Server stellt sicher, dass der Ziel-Workspace und darin der Unterordner `ontologies/` existieren.
* Änderungen (z. B. das Hochladen einer neuen Ontologie oder der Wechsel des Workspace) werden atomar in der Konfigurationsdatei gespeichert.

---

## 3. Dateihandling ohne Kommandozeile (Zero-CLI)

### 3.1 Auto-Discovery
Beim Hochfahren des Servers werden automatisch folgende Pfade nach `*.json`-Dateien durchsucht:
1. `<workspace>/ontologies/*.json`
2. `./ontologies/*.json` (relativ zur Executable / zum aktuellen Verzeichnis)

Jede gefundene Datei wird geprüft: Handelt es sich um eine valide OBO-Graph-Ontologie, wird sie in der `OntologyRegistry` registriert und in der Konfiguration vermerkt. Fehlerhafte oder irrelevante JSON-Dateien werden ignoriert und protokoliert, ohne den Programmstart zu blockieren.

### 3.2 In-App Ontologie-Management & Upload
Neue API-Endpunkte unter `/api/v1/ontologies`:
* `GET /api/v1/ontologies`: Liefert die Liste aller aktuell registrierten Ontologien mit Metadaten (`ontology_id`, `release`, `sha256`, Anzahl der Terme).
* `POST /api/v1/ontologies`: Nimmt einen Multipart-Datei-Upload (`.json`) entgegen.
  - Validiert die OBO-Graph-Struktur.
  - Speichert die Datei persistent unter `<workspace>/ontologies/<filename>`.
  - Registriert sie sofort in der laufenden `OntologyRegistry`.
  - Aktualisiert die persistente Konfiguration.

#### Web-UI-Integration:
* Die Navigationsleiste/Header zeigt einen Indikator für geladene Ontologien (z. B. *"Ontologies: HPO (2024-06), MONDO (2024-05)"*).
* Wenn ein Anwender ein Work Package hochlädt, das eine noch nicht vorhandene Ontologie verlangt (`DomainError: ONTOLOGY_NOT_FOUND`), zeigt die Oberfläche keinen kryptischen Fehler mehr, sondern einen geführten Modal-Dialog:
  > **„Fehlende Ontologie: [ontology_id]“**  
  > *„Dieses Paket benötigt die Ontologie '[ontology_id]'. Bitte wähle die passende JSON-Datei aus oder lade sie hoch.“*  
  > `[Datei auswählen / Drag & Drop]`
* Sobald die Datei hochgeladen ist, wird das Paket automatisch ohne Seiten-Neuladen geöffnet.

### 3.3 Sichere Auswertung von Startargumenten (`sys.argv`)
Falls `ontocurator` per Doppelklick auf eine Datei, „Öffnen mit...“ oder Drag & Drop auf das Programmsymbol gestartet wird, übergibt das Betriebssystem Pfade als Positionsargumente:
* `.zip`: Startet den Server, importiert das Paket direkt in den Workspace und öffnet die UI mit Fokus auf diesem Paket.
* `.json`: Prüft auf OBO-Graph, kopiert nach `<workspace>/ontologies/`, registriert die Ontologie und startet normal.
* Verzeichnis: Verwendet dieses Verzeichnis als `workspace_dir`.
* Alle anderen oder fehlerhaften Eingaben fallen sicher auf den regulären Start zurück (Defense in Depth).

---

## 4. Standalone-Paketierung (PyInstaller Pipeline)

### 4.1 Build-Skript `scripts/build_standalone.py`
Das Skript führt folgende Schritte deterministisch aus:
1. **Frontend-Build:** Führt `npm run build` in `frontend/` aus.
2. **Asset-Synchronisation:** Kopiert die kompilierte SPA nach `src/ontocurator/web/`.
3. **PyInstaller Execution:**
   - Entry-Point: `ontocurator.cli:main`
   - Modus: `--onedir` (Ordnerstruktur) für schnellen Start ohne Dekomprimierungs-Latenz.
   - Eingebettete Daten: `src/ontocurator/web` -> `ontocurator/web`, `src/ontocurator/storage/*.sql` -> `ontocurator/storage`.
   - Hidden Imports: `uvicorn.logging`, `uvicorn.loops`, `uvicorn.protocols`, `sklearn`, `scipy`.
4. **Verpackung des portablen Distributions-ZIPs:**
   Struktur des resultierenden Archivs `dist/ontocurator-portable-<os>-<arch>.zip`:
   ```
   ontocurator/
   ├── ontocurator.exe (bzw. ontocurator unter Unix)
   ├── _internal/          <-- Python-Runtime und Bibliotheken (PyInstaller)
   ├── ontologies/         <-- Drop-Ordner für hp.json, mondo.json
   │   └── README.txt      <-- "Legen Sie hier Ihre OBO-Graph-JSON-Dateien ab"
   ├── workspace/          <-- Lokale Datenbank und Arbeitsordner
   └── README.txt          <-- Schnellanleitung (Doppelklick zum Starten)
   ```

---

## 5. Teststrategie

1. **Unit & Integrationstests Backend:**
   - Tests für `PersistentConfig`: Laden, Speichern, Fallback, OS-Pfade.
   - Tests für Auto-Discovery in `<workspace>/ontologies/`.
   - Tests für `/api/v1/ontologies` (GET Liste, POST Upload, Registrierung).
   - Tests für fehlerresistentes Argument-Parsing (`sys.argv`).
2. **Frontend-Tests:**
   - Test für den Ontologie-Upload und die Fehlerauflösung bei `ONTOLOGY_NOT_FOUND`.
3. **E2E Build-Verifikation:**
   - `build_standalone.py` baut das Paket.
   - Die gebaute Executable wird im Test gestartet, `/api/v1/ontologies` wird per HTTP abgefragt und der Prozess sauber beendet.
