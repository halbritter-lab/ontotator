# Konfigurierbare Arbeitspakete und unabhängige Annotationsschichten

Datum: 2026-10-02

Status: Planungsentwurf aus dem Gespräch; keine Implementierungsfreigabe.
Auftrag: Planung einschließlich Schutz des ursprünglichen Arbeitsablaufs.
Codebasis beim Lesen: `e067e0f1a5f978271ac39f8bef89ce5c12d12f49`.
Im selben Repository laufen gesonderte UI-Arbeiten. Vor Umsetzung deren
abgeschlossenen Stand übernehmen und Dateizustand erneut prüfen.

Plan: [Umsetzung](../plans/2026-10-02-configured-annotation-layers.md).

## 1. Zweck und Architekturentscheidung

Ontotator bleibt ein lokaler Editor für die unabhängige Annotation und die
herkunftsunabhängige Prüfung von Ontologieannotation auf Texten. Ein Arbeitspaket
enthält geordnete Fälle, eine vollständige Aufgabenbeschreibung und optional
vorhandene Annotationen. Die annotierende Person muss keine Konfiguration schreiben.

Mehrere unabhängige Annotationsschichten können denselben Text annotieren. Jede
Schicht bindet genau eine Ontologieversion und mindestens einen Annotationstyp.
Mehrere Schichten dürfen dieselbe Ontologie verwenden. Ein Paket darf mehrere
Ontologien enthalten. Quell- und Zielannotation müssen einander nicht entsprechen:
keine verpflichtende Zuordnung, keine automatische Übertragung, keine implizite
Äquivalenz und keine Vollständigkeitsprüfung anhand der Anzahl von Quellbegriffen.

Der empfohlene Weg ist die gezielte Entkopplung des bestehenden Kerns. Weiteres
Ergänzen von Legacy-Fallbacks widerspricht dem Auftrag. Ein universelles Plugin-
oder Workflow-System würde den klaren Anwendungsfall unnötig ausweiten.

Die bisherigen Generalisierungsdokumente vom 2026-10-01 sind historischer Kontext.
Nach Annahme dieses Entwurfs ersetzt er deren Anforderungen an Legacy-Unterstützung,
eine einzige Serverontologie und implizite klinische Profilauflösung. Sicherheits-,
Provenienz-, Evidenz-, Autosave- und Reviewgarantien bleiben fachlich erhalten.

## 2. Nicht verhandelbare Anforderungen

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

## 3. Umfang und bewusste Grenzen

In dieser Ausbaustufe ist jeder Annotationstyp eine Ontologieannotation mit einem
Term, null oder mehreren Evidenz-Erwähnungen und konfigurierten kategorialen Achsen.
Typen können unterschiedliche Achsen und Evidenzpflicht haben. Damit wird keine
Unterstützung beliebiger Annotationstrukturen behauptet.

Nicht enthalten: reine Kategorien ohne Ontologieterm, allgemeine Relationen,
automatische Ontologieübersetzung, Mappingbewertung, Adjudikation, frei ausführbare
Konfigurationsregeln, grafischer Profileditor und zusätzliche Ontologieparser.
OBO Graph JSON bleibt das unterstützte Ontologieformat; eine Registrierung
mehrerer Dateien bedeutet keine allgemeine OWL-Unterstützung.

## 4. Paket- und Profilvertrag

Neue Vertragskennungen:

| Vertrag | Kennung |
| --- | --- |
| Arbeitspaket | `ontotator-work-package/v2` |
| Aufgabenprofil | `ontotator-task-profile/v1` |
| Annotationssnapshot | `ontotator-annotation/v3` |
| Abgabesnapshot | `ontotator-submission/v2` |

`PackageManifest` enthält `package_id`, `format_version`, `document_order`,
`task_profile`, `task_profile_sha256`, `file_hashes`, `created_at` und optionale
Ursprungsreferenzen. `document_order` listet jede Dokument-ID genau einmal auf.
Fehlende, zusätzliche oder doppelte IDs werden beim Import abgelehnt.

`TaskProfile` enthält Schema-Kennung, Profil-ID und Version, Ontologiedefinitionen,
geordnete Schichten, `default_layer_id` und optionale Preset-Herkunft.

Eine `OntologyDefinition` enthält paketlokale `ontology_id`, Label, Release,
SHA-256 und `format: "obo-graph-json"`. Optional verweist `resource_path` auf eine
gehashte Datei im Archiv. Ohne eingebettete Datei wird ein lokal bereitgestelltes
Artefakt anhand seines Hashs aufgelöst. Keine automatische Netzbeschaffung.
Fehlende Ressourcen werden zusammen mit einer konkreten Bereitstellungsanweisung
gemeldet; es gibt keinen stillen Wechsel auf eine andere Version.

Eine `LayerDefinition` enthält `layer_id`, Label, `ontology_id`,
`access: "editable" | "reference"`, `default_visible`, `default_type_id` und
geordnete `annotation_types`. Jede Schicht hat mindestens einen Typ; IDs sind
innerhalb ihrer jeweiligen Sammlung eindeutig und nicht leer. Mindestens eine
Schicht ist editierbar, und `default_layer_id` verweist auf eine solche Schicht.

Eine `AnnotationTypeDefinition` enthält `type_id`, Label, `axes` und
`evidence_policy: "optional" | "required_on_complete"`. Achsen verwenden
`AxisDefinition(id, label, options, allow_empty)` mit den vorhandenen strikten
Werteprüfungen. Leere Achsenlisten sind gültig. Fehlende Achsenwerte sind unbekannt;
klinische Werte werden nicht automatisch gesetzt. Entwürfe dürfen unvollständig
sein; Bestätigen, Ersatzfreigabe und Abschließen prüfen die Pflichtangaben.

Presets werden bei der Paketerstellung in ein vollständiges Profil aufgelöst.
Ein optionales HPO-Preset wird als gewöhnliche Datendatei ausgeliefert. Die heute
vorläufigen Achsenwerte werden nicht durch diesen Plan zu fachlich endgültigen
Benchmark-Achsen erklärt. Die erste technische Fixture nutzt explizit die
bestehenden Werte present/absent/uncertain, patient/other und
current/historical/future, alle mit `allow_empty=true` und optionaler Evidenz.
Das Profil erhält dafür den eindeutigen Namen `hpo-context-example/v1`.

## 5. Annotationen, Evidenz und Identität

`Annotation` enthält `annotation_id`, `document_id`, `layer_id`, `type_id`,
`term_id`, `axes_values`, `evidence_refs` und `provenance`. Term-IDs werden nur
gegen die durch die Schicht bestimmte Ontologie aufgelöst. Schicht und Typ einer
bestehenden stabilen Annotation sind unveränderlich; ein fachlicher Wechsel
erzeugt eine neue Annotation. Ein Bedienwechsel verändert keine gespeicherte Annotation.

Ein V3-Snapshot bindet Annotation, referenzierte Evidenzversionen, Dokument-ID,
Text-Hash, `layer_config_sha256`, `ontology_sha256` und die Schema-Kennung.
`version` ist der RFC-8785-Hash dieses Inhalts ohne das Feld `version`.
Der Schichthash bindet die vollständige Schichtdefinition einschließlich ihrer
Typen und der aufgelösten Ontologiedefinition. Ein Snapshot hängt nicht vom
Gesamtprofilhash ab: Ein Export kann nicht benötigte Schichten entfernen, ohne
eigene historische Annotationsversionen zu verändern.

Das vollständige Profil ist am Paket und Abschlussumfang gebunden. Änderungen
an dessen Bedeutung erzeugen ein neues Paket; kein Profil wird im bestehenden
Arbeitsbereich ausgetauscht. Einzelne exportierte Annotationen müssen ihre
Definitionsabhängigkeiten mitführen oder eindeutig auf mitgelieferte Definitionen
verweisen. Ontologiespezifische Feldnamen oder Feld-Aliase gibt es nicht.

Evidenz bleibt dokumentbezogen und durch ID und Version gebunden. Verschiedene
Schichten können dieselbe Evidenz nutzen, müssen dies aber nicht. Wiederholte
Erwähnungen, diskontinuierliche Segmente, Überlappung und Verschachtelung bleiben
erhalten. Eine normale Änderung erzeugt eine eigene Evidenzfassung für die
gewählte Annotation; sie verändert keine Quellschicht oder fremde Entscheidung.

Eine strukturierte Verknüpfung zwischen Quell- und Zielannotation ist in dieser
Ausbaustufe nicht erforderlich. Allgemeine vorhandene Herkunftsangaben bleiben
erhalten, werden aber nicht als Termmapping interpretiert. Ein späteres Modell
für ausdrücklich berücksichtigte Quellen muss optional und versionsgebunden sein.

## 6. Arbeitsmodi und Abschlussumfang

Die Modi sind `independent`, `review` und neu `assisted`:

| Modus | Importierte Annotationen | Entscheidungen |
| --- | --- | --- |
| independent | Keine, auch keine Quellschichtdaten | Keine Pflichtentscheidungen |
| review | Explizite Reviewzielmenge und zulässiger Referenzkontext | Bestehende vier Reviewaktionen |
| assisted | Referenzannotation zur Unterstützung einer eigenständigen Neuannotation | Keine Mapping- oder Reviewpflicht |

Der neue Modus macht sichtbar, dass Quellen betrachtet werden dürfen; er behauptet
keine unabhängige bzw. verblindete Annotation. Menschliche und maschinelle Quellen
werden identisch behandelt. Importierte Snapshots sind in allen Modi unveränderlich.

Ein `TaskScope` bestimmt geordnete `editable_layer_ids` und `reference_layer_ids`.
Er wird beim Öffnen serverseitig aus dem Profil und Modus gebildet, nicht aus
Sichtbarkeitsschaltern. Zunächst gehören alle editierbaren Profilschichten zum
Abschlussumfang. In independent ist die Referenzliste leer. In assisted/review
enthält sie die Referenzschichten. Es gibt zunächst keinen Umfangs-Konfigurator
in der Oberfläche. `scope_id` bindet Modus, Gesamtprofilhash und beide Listen.
`WorkspaceKey` ergänzt diese `scope_id`; die bestehende explizite Reviewzielmenge
mit eigenem Hash bleibt erhalten. Reviewziele müssen aus editierbaren Schichten
des Umfangs stammen; Referenzschichten erzeugen keine Pflichtentscheidungen.

Entwurf und Abgabe speichern `checked_layer_ids`. In einem Ein-Schicht-Paket
ersetzt dies intern den bisherigen Dokument-geprüft-Wert, ohne die Bedienung zu
ändern. Bei mehreren Schichten gilt die vorhandene Aktion „Text geprüft“ für
die aktive editierbare Schicht. Der Abschluss prüft alle Schichten im Umfang,
Pflichtwerte sowie alle expliziten Reviewziele. Ausblenden verringert diesen
Umfang nicht. Null-Befund-Abschluss bleibt pro Schicht möglich. Der Status der
Fälle wird aus den Arbeitsbereichen dieser Person und dieses Modus ermittelt.
Eine inhaltliche Bearbeitung oder geänderte Reviewentscheidung entfernt die
Prüfmarke der betroffenen editierbaren Schicht. Andere Schichten bleiben geprüft.
Navigation und Sichtbarkeitsänderungen entfernen keine Prüfmarken. Beim erneuten
Bearbeiten einer abgegebenen Schicht gilt diese Regel nur für den neuen Entwurf;
die frühere Abgabe bleibt unverändert.

Review-Ersatzfassungen gehören zur gleichen Schicht und zum gleichen Typ wie ihr
Ziel; eine Annotation in einer anderen Ontologie ist keine Reviewkorrektur.
Bestätigungen binden weiterhin exakt Ziel- und gegebenenfalls Ersatzversion.
Nach Änderung einer Ersatzfassung ist erneute Prüfung erforderlich.

Unabhängige Ansichten, Revieweingangslisten, Suchereignisse, Fehlerantworten und
Exporte dürfen keine verborgenen Vorschläge, Zähler, Evidenz oder Referenzen
verraten. Exporte dieses Modus enthalten eigene Daten und deren Abhängigkeiten;
ein neues äußeres Profil darf nicht benötigte Quellschichten entfernen. In
assisted/review darf autorisierter Referenzkontext mitgeführt werden. Exportrechte
folgen dem Modus, nicht dem momentanen Sichtbarkeitszustand.

## 7. Oberfläche und Schutz des ursprünglichen Zwecks

### Ein Schicht, ein Typ

Paket öffnen, lokale Identität und Modus wählen, Fall öffnen, markieren, Term
suchen, Achsen bearbeiten, prüfen und abschließen. Schicht und Typ sind automatisch
gewählt. Es gibt keinen Schichtschalter, keinen Ontologie- oder Typdialog und
keine Mappingfelder. Die vorhandene spanlose Annotation bleibt direkt erreichbar.
Eine leere Achsenliste blendet den Achsenbereich aus.

### Mehrere Schichten oder Typen

Nur bei mehreren zugänglichen Schichten erscheint eine kompakte Schichtliste:
Sichtbarkeitsschalter pro Schicht und eine getrennte Auswahl der aktiven
editierbaren Schicht. Referenzschichten tragen eine Textkennzeichnung und lassen
sich nicht aktivieren. Auswahl einer ausgeblendeten Schicht blendet sie ein.
Ausblenden der aktiven Schicht beendet die aktive Auswahl; vor einer neuen
Annotation muss eine editierbare Schicht ausdrücklich gewählt werden. Es wird
niemals still auf eine andere Ontologie gewechselt.

Bei mehreren Typen in der aktiven Schicht erscheint eine Typauswahl mit deren
konfiguriertem Default. Bei nur einem Typ entfällt sie. Details einer vorhandenen
Annotation richten sich stets nach deren eigener Schicht und ihrem Typ.
Suchtreffer, Terminologie und Hierarchiehinweise stammen nur aus der zuständigen
Ontologie. Nach Schichtwechsel dürfen verspätete Suchantworten nicht übernommen
werden. Überlappende Markierungen bleiben auswählbar; Schichtnamen ergänzen Farbe.
Alle Schalter sind beschriftet, tastaturbedienbar und zeigen ihren Zustand.

### Navigation und Speichern

Fallliste, Vor/Zurück und „Fall n von N“ verwenden die Reihenfolge im Paket.
Am Rand sind die jeweiligen Navigationsaktionen deaktiviert. Fallwechsel wartet
auf die gemeinsame Schreibwarteschlange; ein Speicherfehler oder Revisionskonflikt
hält den aktuellen Fall mit den lokalen Änderungen offen. Wechseln schließt
keinen Fall automatisch ab und setzt keine Reviewentscheidung.

Auch ein Schichtwechsel wartet auf ausstehende Mutationen, bevor neue Schreib-
aktionen möglich sind. Suche und Auswahl werden mit Dokument-, Schicht- und
Typidentität gebunden. Sichtbarkeit und aktive Schicht sind lokale Präferenzen
pro Paket, Person und Modus; sie verändern weder Revision noch Inhaltsversion.
Bei Neustart werden Präferenzen gegen den aktuellen Umfang geprüft.

## 8. Architektur und Kompatibilitätsschnitt

Neue Module für Profilvalidierung, Scope-Bildung und Ontologieregistrierung
ersetzen verstreute Fallbacks. API, Editieren, Review und Abgabe verwenden dieselbe
aufgelöste Definition. Suchindex-Caches werden nach Ontologiehash geführt;
Suchanfragen und Suchereignisse tragen Schicht- und Ontologieidentität.

Neue Installationen verwenden das explizit gekennzeichnete Workspaceformat
`ontotator-workspace/v4`. Die Versionsprüfung erfolgt vor DDL oder Schreibzugriff.
Alte Datenbanken werden ohne Migration und ohne Änderung abgelehnt, mit Hinweis
auf einen neuen Workspace bzw. ein externes Konvertierungswerkzeug. Kein Löschen,
kein Reset, keine automatische Übernahme historischer Reviews. Das neue Schema
darf dieselben allgemeinen Tabellenkonzepte weiterverwenden; Legacy-Upgradelogik
gehört nicht zum neuen Startpfad.

Alte Pakete und schemafreie bzw. V2-Annotationssnapshots werden ausdrücklich
abgelehnt. Keine `hpo_id`-Aliase, `_legacy_wire`-Caches oder klinischen
Sondervalidierungen. Die CLI bleibt im einfachen Fall ein einziger Startbefehl;
ein optionales `--ontology PATH` stellt ein lokales Artefakt bereit, ohne eine
einzige globale Ontologie für alle Pakete festzulegen. Für mehrere externe
Dateien ist die Option wiederholbar. Eingebettete Dateien benötigen keine Flags.

Paketimport prüft Profile, Dateien, Ontologiedigests und Referenzen atomar.
Bestehende Archivlimits und Pfadprüfungen gelten auch für Ontologiedateien.
Größere Ontologien können extern bereitgestellt werden; dieser Plan erhöht
Limits nicht pauschal. Vollständige Datenpakete funktionieren nach Installation
offline und ohne Node.js zur Laufzeit.

## 9. Abnahme und Reihenfolge

Zuerst wird der Ein-Schicht-Vertrag mit dem vorhandenen HPO-Ablauf abgesichert,
dann die zweite Ontologie ergänzt. Beide verwenden dieselben Codepfade.
Verglichen wird mit dem nach Abschluss der parallelen UI-Arbeit vorhandenen
Bedienablauf. Für Paketöffnung, Annotation, Review und Abschluss sind null neue
Pflichtinteraktionen erlaubt, abgesehen vom einmaligen Bereitstellen eines
explizit fehlenden Ontologieartefakts. IDs und Versionshashes bleiben im Normalfall
außerhalb der primären Bedienoberfläche.

Abnahmepakete sind synthetisch: (A) HPO, eine Schicht/ein Typ; (B) zwei Ontologien
mit einer Referenz- und einer Zielschicht; (C) zwei editierbare Schichten und zwei
Typen mit verschiedenen Pflichtregeln. B enthält absichtlich unverbundene,
überlappende und zahlenmäßig unterschiedlich viele Quell-/Zielannotation.

Getestet werden außerdem unabhängige Ansichten ohne Leaks, identische Term-ID
in zwei Ontologieartefakten, falsche Hashes, alte Formate, unveränderte Alt-DBs,
Copy-on-write-Evidenz, Nicht-BMP-Offsets, Null-Befund-Abschluss, Reviewkorrektur,
Neustart, atomarer Import, Export/Reimport, konkurrierende Revisionen und
verlorene Mutationantworten. Ein ausgeblendeter Layer beeinflusst niemals den
fachlichen Export oder Abschlussumfang.

Dieser Plan liefert keine Benchmark-Konvertierung. Ein eigener Folgeauftrag
kann im Benchmark-Repository Paketerzeugung und Rückübernahme implementieren,
nachdem der allgemeine Vertrag steht. Nicht darstellbare Benchmarkinformationen
werden dabei gemeldet, nicht stillschweigend abgeflacht.
