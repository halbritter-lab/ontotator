<!-- Original read-only Claude Code review before the documented correction pass. -->

# Review T0: Term-ID und externer Link im Baum (`cfa1553..6d550cc`)

Ich habe nur gelesen und nichts ausgeführt. Die Layout-Zahlen in Befund 1 habe ich aus dem CSS berechnet, nicht im Browser gemessen.

## Critical
Keine.

## Important

**1. ID und Link drücken das Label in schmalen oder tiefen Bäumen auf wenige Zeichen zusammen**
`frontend/src/styles.css:1588-1602`, `frontend/src/editor/TermTree.tsx:117-131`

- **Ursache:** `.tree-id` und `.tree-external` haben `flex-shrink: 0`. Die Zeile hat `overflow-wrap: anywhere` (`styles.css:1274`), und `.tree-label` hat `min-width: 0` (`:1310`). Jeder Pixel für die ID fehlt also dem Label, und das Label bricht dann mitten im Wort um.
- **Rechnung:** ID mit 10 Zeichen in 0.72rem mono ≈ 69 px, Link ≈ 14 px, zwei Gaps 12 px. Das sind etwa 95 px zusätzliche feste Breite pro Zeile.
- **Tablet-Layout (701–1024 px):** Die Baumspalte ist `(Breite − 220)/2` breit, bei 800 px also rund 290 px abzüglich Scrollbar.
  - Tiefe 5 mit Zähler und „current“-Pill: Für das Label bleiben etwa 40 px. „Seizure“ bricht bereits um.
  - Tiefe 8–10, die in HPO normal ist: Das Label hat rund 0 px und steht als senkrechte Spalte einzelner Buchstaben da. Jede Zeile wird dadurch sehr hoch.
- **Wide-Layout (380 px Spalte):** Ab Tiefe ≈ 10 mit „current“ bleiben nur etwa 30 px für das Label.
- **Warum die Tests das nicht finden:** Die Layout-Tests (`tree.spec.ts:535ff`, `:838ff`) prüfen nur die Grenzen des Panels. Die Fixture-Labels sind kurz und flach.
- **Reproduktion:** Viewport 800×700 einstellen, einen tiefen HPO-Term öffnen (z. B. HP:0000407 oder tiefer), „Show in tree“ klicken. Die Labels der tiefen Zeilen brechen zeichenweise um.
- **Fix-Vorschlag:** Das Label bekommt eine Mindestbreite, und ID und Link weichen aus:
  - entweder `.tree-browser__tree { container-type: inline-size }` mit `@container (max-width: 340px) { .tree-id { display: none } }` (die ID steht ja im Detailbereich),
  - oder `.tree-label { flex: 1 1 10ch; min-width: 10ch }` zusammen mit `.tree-item { flex-wrap: wrap }`.
  - Dazu ein Playwright-Check bei 800 px: Breite von `.tree-label` ≥ X auf einer tiefen Zeile.

## Minor

**2. Ein Mausklick auf den Link in der Zeile holt den Fokus in den Baum und verschiebt den Roving-Tabstop**
`TermTree.tsx:104` und `:119-127`

- **Ablauf:** Der Link hat `tabIndex={-1}`, ist also per Klick fokussierbar. Ein Klick fokussiert den Link. Reacts `onFocus` am `li` reagiert auf das hochblubbernde Focus-Ereignis und ruft `onFocusKey(row.key)` auf. Damit liegt der Tabstop jetzt auf der angeklickten Zeile, nicht mehr auf der ausgewählten. Der Fokus sitzt dabei ohne sichtbaren Indikator auf dem Link.
- **Folge:** Enter auf diesem Link öffnet nicht die Seite. Der `keydown` erreicht `handleKeyDown` am `ul`, `keyAction` liefert „select“, und `preventDefault` verhindert die Navigation. Die Zeile wird stattdessen ausgewählt.
- **Reproduktion:** Zeile A ist ausgewählt. Auf ↗ in Zeile B klicken, das Popup schließen, Shift+Tab und dann Tab. Der Fokus landet auf B statt auf A.
- **Warum die Tests das nicht finden:** Der Browser-Test prüft nur `aria-selected`. Der Vitest-Test „Enter…“ feuert auf dem `li`, nicht auf dem fokussierten Link.
- **Fix:** Am Zeilen-Link `onMouseDown={(e) => e.preventDefault()}` setzen. Dann wird der Link nicht fokussiert, der Klick navigiert aber trotzdem.

**3. Der Zeilenname enthält die Kinderzahl nicht mehr**
`TermTree.tsx:91`, `:133`

- **Vorher:** Der Name des `treeitem` kam aus dem Inhalt, zum Beispiel „Alpha 1 children“ und gegebenenfalls „current“.
- **Jetzt:** `aria-labelledby` zeigt nur auf das Label. Das `aria-label="N children"` am Zähler wird nicht mehr vorgelesen. „current“ bleibt über `aria-current` erhalten.
- **Folge:** Screenreader-Nutzer hören die Zahl der Kinder nicht mehr. Das ist eine stille Regression, die in Plan-Review T0-5 nicht gewollt war.
- **Fix:** Dem Zähler eine ID geben und `aria-labelledby={`${labelId} ${countId}`}` setzen, oder den Zähler per `aria-describedby` anhängen.

**4. Die IDs der Labels sind nicht pro Instanz eindeutig**
`TermTree.tsx:91`, `:114`

- **Problem:** `tree-label-${row.key}` gilt im ganzen Dokument. Bei zwei gleichzeitig gemounteten `TermTree`s mit gleichen Pfadschlüsseln gäbe es doppelte DOM-IDs. `aria-labelledby` würde dann auf das erste Element im Dokument zeigen.
- **Heute keine Auswirkung:** `CaseScreen.tsx:1863` mountet genau einen `TreeBrowser`, durch `key={nonce}` nacheinander. Das Problem ist also latent.
- **Fix:** Präfix per `const uid = useId()`, also `id={`${uid}-${row.key}`}`.

**5. Der Link in der Zeile ist sehr klein zum Antippen**
`styles.css:1595-1602`

- **Problem:** Bei `font-size: 0.8rem` und `padding: 0 2px` ist die Trefferfläche etwa 14×13 px. Auf Touch-Geräten im ≤700-px-Layout trifft ein knapper Tipp die Zeile, wählt sie also aus, statt den Link zu öffnen.
- **Bewertung:** Das ist harmlos, weil sich Auswahl rückgängig machen lässt, aber unter der WCAG-2.5.8-Empfehlung.
- **Fix:** `padding: 4px` mit negativem Margin, oder `min-width/min-height: 24px` mit zentriertem Inhalt.

## Geprüft ohne Befund

- **CURIE-URLs:** Der Loader liefert nur `^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$` (`hpo.py:33,79-91`). Leerzeichen, `/` und IRIs kommen also nicht vor.
  - HP und MONDO bleiben lesbar, alles andere wird kodiert. Die OLS-Query ist vollständig kodiert.
  - Pfadschlüssel mit `/` sind eindeutig, und IDs mit `:` oder `/` sind für `getElementById` gültig.
- **API-Kompatibilität:** Das Feld ist optional mit Default `None` und kommt nur in Responses vor (`tree_routes.py`). Alte Clients ignorieren es. Das neue Frontend fängt fehlende Felder mit `?? null` ab. Contract und TS sind konsistent.
- **Event-Bubbling:** `stopPropagation` beim Klick verhindert Auswahl und Aufklappen. Ctrl-, Shift- und Mittelklick sowie das Kontextmenü wählen ebenfalls nicht aus. Die globalen Shortcuts in `CaseScreen` verhalten sich am Detail-Link wie an jedem Button.
- **Tab-Reihenfolge:** Zeile → Detail-Link → „Use this term“ und rückwärts. Das entspricht der Vorgabe. Zeilen-Links haben keinen eigenen Tabstop.
- **Detail-Link:** `target`/`rel` und Accessible Name sind korrekt. Bei `collapsed` wird der Fokus über den bestehenden Blur-Effekt mit erfasst.

## Nicht beurteilt

- Ob `https://monarchinitiative.org/MONDO:…` und `https://www.ebi.ac.uk/ols4/search?q=…` heute tatsächlich auflösen. Ich habe keinen Netzzugriff verwendet. Das HPO-Format entspricht dem aktuellen Schema.
- OLS-Fallback für projekteigene Ontologien (OWN, TEST): Jede Zeile bekommt einen Link, der zu einer leeren OLS-Suche führt, und der Name lautet „View … on www.ebi.ac.uk“. Die Spec will das bis T3 ausdrücklich so.
- Die Payload-Grenze von 40k auf 70k und der zusätzliche Tabstop im Detailbereich sind vom Nutzer so akzeptiert.
- Der Inhalt der minifizierten Assets. Ich habe nur geprüft, dass `index.html` auf die neuen Hash-Namen zeigt.
- Wie die Screenreader im Einzelnen ansagen (NVDA/JAWS/VoiceOver mit `aria-current`). Das habe ich nicht real getestet.

## Merge-Bereitschaft

**Noch nicht ganz merge-bereit.** Funktion, Backend und API sind sauber, und die Tests decken den Kernpfad gut ab. Befund 1 sollte vor dem Merge behoben werden: Er macht den Baum im Tablet-Layout und bei tiefen HPO-Zweigen schwer lesbar, und der Fix ist ein kleiner CSS-Eingriff mit einem Layout-Test. Befunde 2–5 können im selben Zug oder als Folge-Commit erledigt werden. Keiner davon blockiert.
