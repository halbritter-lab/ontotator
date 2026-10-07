# Design: Term-Suche – eine Suche, Übersetzungen, Baum

**Datum:** 2026-10-07
**Status:** Freigegeben
**Thema:** Die Termauswahl im Case-Screen vereinfachen und erweitern

---

## TL;DR

- **Eine Suche:** Die Auswahl „Search Strategy" entfällt. Ein Suchfeld findet Terme über Code oder Stichwort. Exakte Namenstreffer stehen oben, ähnliche Treffer folgen in gemischter Reihenfolge.
- **Übersetzungen:** Offizielle HPO-Übersetzungsdateien (Babelon-TSV) liegen neben der Ontologie und werden mit durchsucht. Zielsprachen sind die von Phentrieve unterstützten: Deutsch, Spanisch, Französisch, Niederländisch (Englisch ist immer dabei). Welche der geladenen Sprachen durchsucht werden, stellt jeder Annotator über einen kleinen Flaggen-Knopf rechts im Suchfeld ein (Aufklappliste mit Checkboxen); die Wahl bleibt für ihn gespeichert.
- **Baum:** Am Term einer eigenen Annotation öffnet ein Knopf ein Fenster mit dem aufklappbaren Ontologie-Baum, aufgeklappt an diesem Term. Ein Klick wählt aus, „Use this term" ersetzt den Term der Annotation. Angeheftet bleibt der Baum als Seitenbereich offen und folgt der ausgewählten Annotation.
- **Nachvollziehbarkeit bleibt:** Die App speichert schon heute zu jeder Suche, was gesucht und was angezeigt wurde, und zu jeder Termwahl, aus welcher Suche sie stammt. Das gilt künftig genauso für die neue Suche und für den Baum.
- **Umsetzung in drei Plänen**, in dieser Reihenfolge: (1) eine Suche, (2) Übersetzungen, (3) Baum.

---

## 1. Ziel und Umfang

Heute wählt man im Suchfeld eine von vier Strategien (lexikalisch, exakt, Identifier, Hierarchie). Die Hierarchie-Suche zeigt nur Kinder und Geschwister und verlangt eine eingetippte ID. Übersetzte Termnamen kann das Backend zwar laden, bekommt sie aber von niemandem übergeben.

Ziel: Der Annotator tippt ein Stichwort oder einen Code in seiner Sprache und bekommt Kandidaten; von einem gewählten Term aus kann er im Baum zu allgemeineren oder spezifischeren Termen wechseln.

Nicht Teil dieses Designs: semantische (Embedding-)Suche, automatischer Download von Übersetzungen, Übersetzungen im Arbeitspaket, Baum als Einstieg ohne Startterm, Graph-Darstellung.

---

## 2. Eine Suche

### Verhalten

Das Suchfeld (`SearchPanel`) hat keine Strategie-Auswahl mehr. Jede Eingabe geht mit der neuen Route `auto` an `POST /api/v1/search`.

Das Backend entscheidet:

1. **Code:** Sieht die Eingabe wie ein Identifier aus (nur Ziffern, `PREFIX:Ziffern` oder `PREFIX_Ziffern`), liefert die Suche genau diesen Term (heutige Route `id`) – oder nichts, wenn es ihn nicht gibt. Es folgen keine weiteren Treffer.
2. **Stichwort:** Sonst besteht die Liste aus zwei Blöcken:
   - **Exakte Treffer** auf Name oder Synonym (heutige Route `exact`, ohne deren Präfix-Fallback), in der festen Reihenfolge Name vor Synonym. Mit geladenen Übersetzungen zählen auch übersetzte Namen.
   - **Ähnliche Treffer** der lexikalischen Suche, ohne die Terme aus dem ersten Block, in der bisherigen gemischten Reihenfolge (gleicher Seed wie heute: Annotator, Annotation, Anfrage, Tiefe).

   Zusammen höchstens `k` Kandidaten (Standard 10); exakte Treffer haben Vorrang.

Begründung für „exakt oben": Ein exakter Namenstreffer ist eine Tatsache über die Eingabe, keine Bewertung. Die gemischte Reihenfolge schützt weiter vor Verankerung dort, wo die Reihenfolge aus einem Ähnlichkeitswert käme.

### Protokoll und Schnittstelle

- `SearchRequest.route` nimmt zusätzlich `"auto"` an; `"auto"` wird der Standardwert. Die alten Werte bleiben gültig, damit gespeicherte Protokolle und fremde Aufrufer weiter funktionieren. Die Oberfläche schickt nur noch `auto`.
- `SearchCandidate` bekommt ein Feld `route` (`"id"`, `"exact"` oder `"lexical"`): der Weg, über den dieser Kandidat in die Liste kam. `match_kind` bleibt (z. B. `label`, Synonymtyp, `id`).
- `SearchCandidate` bekommt ein Feld `match_language` (z. B. `"de"`, `"en"`, sonst `null`), sobald der Treffer über einen übersetzten Namen kam.
- `SearchResult.shuffled` ist `true`, wenn der Block der ähnlichen Treffer gemischt wurde. `ranked_ids` enthält die Reihenfolge vor dem Mischen: erst die exakten Treffer, dann die ähnlichen nach Wert. `displayed_ids` ist die gezeigte Reihenfolge.
- Das Suchereignis (`SearchEventRecord`) wird mit `route = "auto"` gespeichert. Zusätzlich hält es je Kandidat den Weg fest: neues Feld `candidate_routes: dict[str, str]` (Term-ID → `id`/`exact`/`lexical`), Standard leeres Dict, damit alte Ereignisse lesbar bleiben. Damit lässt sich später auswerten, wie viele gewählte Terme exakt, ähnlich oder per Code gefunden wurden.
- Die Bindung einer Auswahl an ihr Suchereignis (`search_event_id` bei `create_annotation` / `set_term`) bleibt unverändert.

### Oberfläche

- Entfernt: das Auswahlfeld „Search Strategy" und der Hinweistext zur ID-Eingabe darunter wird gekürzt auf „Search by name or code (e.g. HP:0001250)".
- Kandidatenkarten zeigen wie bisher Name, ID, Definition und – wenn der Treffer nicht über den angezeigten Namen kam – „Match: »…«" mit Art und ggf. Sprache, z. B. „Match: »Muskelhypotonie« (label, de)".
- Zwischen exaktem Block und ähnlichen Treffern steht keine sichtbare Trennlinie und keine Beschriftung; die Position allein genügt.

---

## 3. Übersetzungen

### Dateien

- Format: die offiziellen Dateien aus `obophenotype/hpo-translations`, also `hp-<sprache>.babelon.tsv` und `hp-<sprache>.synonyms.tsv`. Der vorhandene Leser (`load_translations`) wird unverändert genutzt.
- Ablage: in denselben Ordnern, in denen Ontologien gesucht werden (`<workspace>/ontologies/`, im portablen Bundle zusätzlich `ontologies/` neben der Programmdatei).
- Zuordnung: über den Dateinamen. `<präfix>-<sprache>.*.tsv` gehört zu der geladenen Ontologie, deren dominantes ID-Präfix (kleingeschrieben) `<präfix>` ist; `hp-de.babelon.tsv` also zu HPO. Dateien ohne passende Ontologie werden mit Hinweis übersprungen.
- Geladen werden alle vorhandenen Sprachen, und alle liegen in einem gemeinsamen Index. Welche davon eine Suche berücksichtigt, bestimmt die Sprachauswahl des Annotators (siehe unten).

### Laden

- Die Ontologie-Registry kennt die Suchordner und übergibt beim Laden einer Ontologie die passenden Dateien (`OntologyService.load(..., translation_paths=...)`). Der lexikalische Index wird mit den gefundenen Sprachen gebaut.
- Die exakte Suche bezieht übersetzte Namen ein (Index der normalisierten Namen wird um die Übersetzungen erweitert; Art des Treffers `translation`, Sprache im neuen Feld).
- `index_identity` enthält zusätzlich die sortierte Liste der SHA-256-Summen der geladenen Übersetzungsdateien. Ohne Übersetzungen ist die Kennung dieselbe wie heute.
- Die Bindung eines Pakets an seine Ontologie (SHA-256 der Ontologie-Datei) ist davon nicht betroffen.
- Auch Ontologien, die ein Paket selbst mitbringt, bekommen die Übersetzungen aus den Suchordnern, wenn das Präfix passt.

### In der App

- Upload: `POST /api/v1/ontologies` nimmt zusätzlich `.tsv` an. Eine gültige Babelon-Datei wird unter ihrem Namen in `<workspace>/ontologies/` gespeichert (gleicher Name ersetzt die alte Datei), die betroffene Ontologie wird neu geladen. Das dauert wenige Sekunden; laufende Suchen nutzen bis dahin den alten Index.
- `GET /api/v1/ontologies` liefert je Ontologie ein Feld `translations`: Liste aus Sprache, Dateiname und Anzahl der Terme mit mindestens einem Namen in dieser Sprache.
- Das Dashboard zeigt diese Angaben in der Ontologie-Anzeige, z. B. „HPO 2026-06-23 · de 3 412 · es 18 201 · fr 12 880 terms".

### Sprachauswahl

Der Annotator legt fest, in welchen der geladenen Sprachen gesucht wird.

**Element.** Am rechten Rand des Suchfelds, in derselben Zeile, sitzt ein kleiner Knopf mit den Flaggen der aktiven Sprachen (je 16 px; ab vier Sprachen drei Flaggen und „+n"). Er braucht keine eigene Zeile. Ein Klick öffnet eine Aufklappliste mit einem Eintrag je geladener Sprache: Checkbox, Flagge, Sprachkürzel. Mehr gibt es nicht: kein Knopf in der Kopfzeile, kein Dialog, keine Meldung.

- Der Knopf erscheint nur, wenn für die Ontologie des aktuellen Layers mindestens eine Übersetzung geladen ist. Ohne Übersetzungen sieht das Suchfeld aus wie heute.
- Englisch (die Namen der Ontologie selbst) ist immer aktiv und in der Liste als fest angehakt und nicht abwählbar dargestellt.
- Eine Änderung wirkt sofort: Steht eine Anfrage im Suchfeld, wird sie mit der neuen Auswahl erneut ausgeführt. Die Liste bleibt für weitere Häkchen offen und schließt bei Klick daneben oder `Esc`.
- Der Tooltip eines Eintrags nennt die Zahl der Terme mit einem Namen in dieser Sprache. Der Knopf hat einen Textnamen für Screenreader („Search languages: EN, DE").
- Die Flaggen sind mitgelieferte SVG-Grafiken, keine Emoji: Windows stellt Flaggen-Emoji nur als Buchstabenpaar dar, und das portable Bundle läuft ohne Netz. Zuordnung: en → Vereinigtes Königreich, de → Deutschland, es → Spanien, fr → Frankreich, nl → Niederlande. Für eine Sprache ohne hinterlegte Flagge steht das Kürzel.

**Speicherung.** Die Auswahl wird je Annotator in den Workspace-Einstellungen (`preferences.json`, Endpunkt `/api/v1/preferences`) gespeichert: neues Feld `search_languages_by_annotator` (Annotator-ID → Liste der Sprachkürzel). Sie gilt damit über Fälle, Pakete, Neuladen und Neustarts hinweg und ist an die Initialen gebunden, nicht an den Browser.

- Standard, solange ein Annotator nichts gewählt hat: alle geladenen Sprachen.
- Kommt später eine neue Sprache hinzu, ist sie für Annotatoren mit gespeicherter Auswahl zunächst nicht aktiv; sie steht dann ohne Häkchen in der Aufklappliste.
- Gespeicherte Sprachen, die nicht mehr geladen sind, werden ignoriert und bleiben gespeichert.

**Wirkung auf die Suche.** `SearchRequest` bekommt das Feld `languages` (Liste, optional; fehlt es, gelten alle geladenen Sprachen). Das Backend berücksichtigt nur Namen in Englisch und in den genannten Sprachen: Treffer über einen Namen in einer abgewählten Sprache zählen nicht, weder im exakten noch im ähnlichen Block. Der Index selbst bleibt unverändert (ein gemeinsamer Index, gefiltert wird bei der Anfrage), `index_identity` hängt also nicht von der Auswahl ab.

**Protokoll.** Das Suchereignis hält die bei dieser Suche aktiven Sprachen fest: neues Feld `languages` in `SearchEventRecord` (Standard leere Liste für alte Ereignisse). Der Seed für die gemischte Reihenfolge schließt die Sprachauswahl ein, damit dieselbe Anfrage mit anderer Auswahl als neue Frage gilt.

### Bundles

- `scripts/build_standalone.py` und `scripts/provision_bundle.py` bekommen die wiederholbare Option `--translation TSV`; die Dateien landen im `ontologies/`-Ordner des Bundles.

### Fehlerfälle

| Fall | Verhalten |
|---|---|
| Datei ist keine Babelon-TSV (keine Spalte `subject_id`) | Upload: Fehler 400 mit Begründung. Beim Start: Hinweis in der Konsole, Datei wird übersprungen |
| Keine geladene Ontologie passt zum Präfix | Upload: Datei wird gespeichert, Antwort enthält den Hinweis, dass sie noch keiner Ontologie zugeordnet ist. Beim Start: Hinweis, übersprungen |
| Datei enthält keine einzige verwertbare Zeile | wie „keine Babelon-TSV" |
| Neuladen der Ontologie schlägt fehl | alte Instanz bleibt aktiv, Fehler wird gemeldet |

### Erwartung

Der Nutzen hängt von der Abdeckung ab. Laut den Messungen im Suchmodul: Spanisch 96 % der Terme übersetzt, Französisch 68 %, Deutsch 18 %. Für Niederländisch liegt keine Messung vor. Für Deutsch ist der Baum (Abschnitt 4) deshalb der wichtigere Teil.

---

## 4. Baum

### Einstieg

Ein Knopf „Show in tree" neben dem Termnamen im Annotations-Bereich (`AnnotationPanel`) einer **eigenen** Annotation. Er ist da, sobald die Annotation einen Term hat – also direkt nach der Termwahl bei einer neuen Annotation und beim Öffnen einer vorhandenen. Für Proposals und Referenzen gibt es den Knopf nicht; im Review erreicht man den Baum über „Edit" an der übernommenen Kopie.

Weitere Einstiege (an Suchtreffern, ohne Startterm) gibt es nicht.

### Fenster

Ein Dialog über dem Arbeitsbereich (ca. 900 × 600 px, auf kleinen Bildschirmen bildschirmfüllend), zweispaltig:

- **Links der Baum** ab der Wurzel der Ontologie. Der Startterm ist aufgeklappt, markiert und ins Bild gescrollt; alle Knoten auf einem Pfad von der Wurzel zu ihm sind aufgeklappt.
- **Rechts die Details** des ausgewählten Knotens: Name, ID, Definition, Synonyme, übersetzte Namen nach Sprache, „Also under: …" und der Knopf **„Use this term"**.

Regeln:

- Kinder werden beim Aufklappen nachgeladen. Jeder Knoten zeigt die Zahl seiner Kinder; Knoten ohne Kinder haben kein Dreieck.
- Kinder sind alphabetisch nach Name sortiert. Hier wird nichts gemischt.
- Ein Term mit mehreren Eltern erscheint unter jedem. Beim Öffnen wird der kürzeste Pfad aufgeklappt (bei Gleichstand der alphabetisch erste). „Also under: …" nennt die übrigen Eltern; ein Klick klappt den Pfad über diesen Elternknoten auf und springt dorthin.
- Veraltete Terme erscheinen nicht. Ist der Startterm selbst veraltet oder unbekannt, öffnet der Baum an der Wurzel und zeigt einen Hinweis.
- Ein Klick auf einen Knoten wählt ihn nur aus (Details rechts). Zugewiesen wird erst mit „Use this term". Der Knopf ist deaktiviert, solange der ausgewählte Knoten der aktuelle Term der Annotation ist.
- „Use this term" ersetzt den Term der Annotation (`set_term`), schließt den Dialog und lässt die Annotation ausgewählt. Im Review greift die vorhandene Nachbehandlung (Proposal gilt als „geändert", eine ausdrückliche Ablehnung bleibt).

### Angeheftet offen lassen

Im Kopf des Dialogs sitzt ein Schalter „Keep open" (Pin). Angeheftet wird aus dem Dialog ein Seitenbereich am rechten Rand des Arbeitsbereichs: Baum oben, Details darunter, der Falltext bleibt sichtbar und bedienbar.

- „Use this term" ersetzt den Term und lässt den Baum offen; der neue Term ist danach als aktueller Term markiert.
- Wählt der Annotator eine andere eigene Annotation mit Term aus, springt der Baum zu deren Term (neuer Baum-Durchgang, siehe Protokoll). Ist eine Annotation ohne Term, ein Proposal oder nichts ausgewählt, bleibt der Baum stehen und „Use this term" ist deaktiviert.
- Der Bereich schließt über sein Schließen-Kreuz oder durch Lösen des Pins; `Esc` schließt ihn nur, wenn der Fokus im Baum liegt.
- Ob angeheftet ist, wird je Annotator in den Workspace-Einstellungen gespeichert (`tree_pinned_by_annotator`). „Show in tree" öffnet dann gleich den Seitenbereich. Der Baum öffnet sich nie von selbst, sondern erst nach dem ersten „Show in tree" in einem Fall.
- Auf schmalen Bildschirmen (unter 1100 px Breite) gibt es den Schalter nicht; dort bleibt es beim Dialog.

Tastatur (Muster eines ARIA-Baums, `role="tree"` / `treeitem`): `↑`/`↓` wechseln den Knoten, `→` klappt auf bzw. geht zum ersten Kind, `←` klappt zu bzw. geht zum Elternknoten, `Enter` wählt aus, `Esc` schließt. Der Fokus bleibt im Dialog.

### Schnittstelle

Zwei neue Endpunkte, beide wie die Suche an Workspace und Layer gebunden (gleiche Prüfungen wie `POST /search`):

- `POST /api/v1/terms/tree/open` – Anfrage: `workspace_key`, `annotation_id`, `layer_id`, `term_id` (Startterm). Antwort: `browse_id`, die Wurzelknoten, die aufgeklappten Pfade zum Startterm (je Ebene die Kinder des Pfadknotens), die Details des Startterms. Legt ein Suchereignis mit `route = "browse"` und `query = <Startterm>` an; `browse_id` ist dessen ID.
- `POST /api/v1/terms/tree/node` – Anfrage: `workspace_key`, `annotation_id`, `layer_id`, `browse_id`, `term_id`, optional `via_parent_id`. Antwort: Details des Knotens, seine Kinder (ID, Name, Kinderzahl), seine Eltern, und bei `via_parent_id` der Pfad von der Wurzel über diesen Elternknoten. Wird beim Aufklappen und beim Auswählen eines Knotens aufgerufen.

Ein Knoten in den Antworten besteht aus `term_id`, `label`, `child_count`.

### Protokoll

- Ein Baum-Durchgang beginnt mit jedem `tree/open` – beim Öffnen und, im angehefteten Baum, bei jedem Sprung zu einer anderen Annotation. Jeder Durchgang hat sein eigenes Ereignis und seine eigene `browse_id`.
- Das Ereignis aus `tree/open` hält als `candidates` alle Terme fest, die dem Annotator in diesem Baum-Durchgang gezeigt wurden, in der Reihenfolge ihres ersten Erscheinens: zuerst die beim Öffnen sichtbaren, dann – bei jedem `tree/node` – die neu sichtbar gewordenen Kinder. `ranked_ids` ist dieselbe Liste, `shuffled` entfällt (keine Bewertung).
- „Use this term" schickt `set_term` mit `search_event_id = browse_id`. Die vorhandene Prüfung (Term muss unter den Kandidaten des Ereignisses sein) und das vorhandene Auswahl-Ereignis greifen unverändert. Der Fundweg ist damit `browse`, und das Protokoll zeigt Startterm, gesehene Terme und gewählten Term.
- Wird der Dialog ohne Auswahl geschlossen, bleibt das Ereignis als Suche ohne Auswahl stehen, wie eine Suche, aus der nichts gewählt wurde.

### Backend

- Neue Hilfen im Ontologie-Dienst: Wurzeln (Terme ohne Eltern, nicht veraltet), Kinder eines Terms (nicht veraltet, sortiert), Pfade eines Terms zur Wurzel (kürzester zuerst; optional über einen bestimmten Elternknoten).
- Die bisherige Route `browse` der Suche bleibt in der Schnittstelle gültig, wird von der Oberfläche aber nicht mehr benutzt.
- Der Baum funktioniert für jede geladene Ontologie und richtet sich nach dem Layer der Annotation.

---

## 5. Teststrategie

**Eine Suche**

- Backend: Code-Eingaben liefern genau einen oder keinen Kandidaten; Stichwort liefert exakte Treffer vor den ähnlichen, ohne Dubletten und höchstens `k`; gemischter Block ist für gleiche Eingaben stabil und zwischen Annotatoren verschieden; `ranked_ids`, `displayed_ids`, `candidate_routes` stimmen; alte Routen funktionieren weiter; alte gespeicherte Ereignisse ohne `candidate_routes` bleiben lesbar (Paket-Roundtrip).
- Frontend: kein Strategie-Feld; eine Eingabe löst genau eine Anfrage mit `route: "auto"` aus; Anzeige von „Match" mit Art und Sprache.
- Vertrag: `contracts/openapi.json` und `frontend/src/api/generated.ts` neu erzeugt, `npm run api:check` grün.

**Übersetzungen**

- Backend: Zuordnung über Präfix; Index-Kennung ändert sich mit und nur mit den Übersetzungsdateien; exakte und lexikalische Suche finden einen deutschen Namen und melden `match_language`; fehlerhafte und nicht zuordenbare Dateien blockieren den Start nicht; Upload einer `.tsv` lädt die Ontologie neu; `GET /ontologies` nennt Sprachen und Zahlen.
- Fixture: eine kleine `hp-de.babelon.tsv` passend zu `tests/fixtures/hp.json`.
- Build: `--translation` legt die Datei ins Bundle.
- Frontend: Dashboard zeigt die Sprachen; Upload-Dialog akzeptiert `.tsv`.
- Sprachauswahl, Backend: eine abgewählte Sprache liefert keine Treffer über ihre Namen, Englisch bleibt; fehlendes Feld bedeutet alle Sprachen; das Ereignis nennt die aktiven Sprachen; die Einstellung wird je Annotator gespeichert und getrennt gelesen.
- Sprachauswahl, Frontend: Flaggen-Knopf nur bei geladenen Übersetzungen; die Liste zeigt je Sprache Checkbox, Flagge und Kürzel; Abwählen speichert die Einstellung, wiederholt die laufende Suche und schickt `languages`; nach Neuladen ist die Auswahl wieder da; Englisch ist nicht abwählbar.

**Baum**

- Backend: Wurzeln, Kinder (sortiert, ohne veraltete), Pfade für Terme mit einem und mit mehreren Eltern, `via_parent_id`, unbekannter und veralteter Startterm; das Ereignis sammelt die gezeigten Terme; `set_term` mit `browse_id` wird angenommen für gezeigte und abgelehnt für nicht gezeigte Terme.
- Frontend: Öffnen am Startterm, Aufklappen lädt nach, Tastaturbedienung, „Use this term" schickt `set_term` mit `search_event_id`, Knopf nur an eigenen Annotationen; angeheftet bleibt der Baum nach „Use this term" offen, springt beim Wechsel der Annotation zu deren Term und öffnet nach Neuladen wieder als Seitenbereich.
- Browser: Term suchen und zuweisen, Baum öffnen, ein Kind auswählen und übernehmen; die Annotation trägt danach das Kind.

**Danach jeweils:** eingebettete Web-Assets neu bauen.

---

## 6. Reihenfolge der Umsetzung

1. **Eine Suche** – kleinster Teil, ändert die Schnittstelle (`route: auto`, Felder am Kandidaten), auf die die anderen beiden aufbauen.
2. **Übersetzungen** – nutzt die Felder `match_language` und die exakte Suche aus Teil 1.
3. **Baum** – unabhängig von Teil 2, zeigt aber übersetzte Namen in den Details, wenn sie geladen sind.

Jeder Teil bekommt einen eigenen Umsetzungsplan und ist für sich lauffähig und testbar.
