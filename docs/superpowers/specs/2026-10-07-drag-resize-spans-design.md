# Design: Spans per Ziehen anpassen

**Datum:** 2026-10-07
**Status:** Entwurf zur Prüfung
**Thema:** Kanten vorhandener Mentions im Text mit der Maus oder der Tastatur verschieben

---

## TL;DR

- Ist eine **eigene** Annotation ausgewählt, haben die Segmente ihrer Mentions links und rechts einen Griff. Ziehen verschiebt die Kante zeichengenau, Loslassen speichert, `Esc` bricht ab.
- Proposals und Referenzen haben keine Griffe. Im Review zieht man an der Kopie, die „Edit" anlegt.
- Tastatur: Pfeiltasten verschieben die fokussierte Kante um ein Zeichen, mit `Strg` um ein Wort.
- Nur Frontend: Der vorhandene Befehl `edit_mention` wird mit den neuen Segmenten geschickt. Backend, API und Paketformat bleiben unverändert.

---

## 1. Ziel und Umfang

Ein großer Teil der Arbeit ist das Prüfen maschinell erzeugter Annotationen. Deren Spans sind oft um ein paar Zeichen zu lang oder zu kurz. Heute muss man dafür die Mention lösen und neu markieren. Künftig lässt sich die Kante direkt im Text verschieben.

Nicht Teil dieses Designs: Verschieben ganzer Segmente, Griffe an Proposals oder Referenzen, Rückgängig-Funktion.

---

## 2. Bedienung

### Wann Griffe erscheinen

Griffe erscheinen an allen Segmenten aller Mentions der **ausgewählten kuratierten Annotation** (`selectedAnnotationId`), sofern deren Layer bearbeitbar ist. Das schließt die Kopie ein, die im Review über „Edit" (Adopt & edit) aus einem Proposal entsteht, denn sie ist eine kuratierte Annotation und danach ausgewählt.

Keine Griffe gibt es

- ohne Auswahl,
- an Review-Proposals und Referenz-Annotationen,
- während „+ Add Mention" auf eine Textauswahl wartet,
- solange eine noch nicht gespeicherte neue Annotation (Termsuche offen) aktiv ist.

### Ziehen mit der Maus

1. Maustaste auf einem Griff drücken: Der Ziehvorgang beginnt, die Kante folgt dem Zeichen unter dem Mauszeiger.
2. Die Markierung zeigt die neue Ausdehnung sofort (lokale Vorschau, noch nichts gespeichert).
3. Loslassen: Hat sich das Segment geändert, wird gespeichert. Ist es unverändert, passiert nichts.
4. `Esc` während des Ziehens: alte Ausdehnung wiederherstellen, nichts speichern.

Ein Ziehen am Griff erzeugt keine Textauswahl und damit keine neue Mention. Normales Markieren von Text funktioniert unverändert, auch wenn es innerhalb einer Markierung mit Griffen beginnt.

### Tastatur

Griffe sind fokussierbar (`tabindex="0"`, `role="separator"`, `aria-label` „Start of mention" bzw. „End of mention").

| Taste | Wirkung |
|---|---|
| `←` / `→` | Kante um ein Zeichen verschieben |
| `Strg` + `←` / `→` | Kante zur nächsten Wortgrenze verschieben |

Gespeichert wird 400 ms nach dem letzten Tastendruck oder sobald der Griff den Fokus verliert, damit mehrere Schritte nur eine Änderung erzeugen.

---

## 3. Regeln für die neue Ausdehnung

Die Regeln liegen als reine Funktion vor (kein DOM), damit sie einzeln testbar sind:

```
resizeSegment(text, segments, index, edge, offset) -> segments | null
```

`segments` sind die Segmente einer Mention in UTF-16-Offsets, `index` das gezogene Segment, `edge` `"start"` oder `"end"`, `offset` die Zielposition. Rückgabe sind die neuen Segmente oder `null`, wenn sich nichts ändert.

1. **Zeichengenau:** Die Zielposition wird auf eine Codepoint-Grenze gelegt (nie mitten in ein Surrogatpaar).
2. **Mindestlänge:** Die gezogene Kante wird so begrenzt, dass das Segment mindestens ein sichtbares Zeichen behält; sie kann die andere Kante nicht überschreiten.
3. **Leerraum:** Leerraum am Rand des Ergebnisses wird abgeschnitten, wie beim normalen Markieren (`trimToVisible`). Bliebe nichts Sichtbares übrig, gilt Regel 2.
4. **Verschmelzen:** Berührt oder überlappt das Ergebnis ein anderes Segment derselben Mention, werden beide zu einem Segment (`normaliseSpans`).
5. **Andere Annotationen:** Überlappungen mit Mentions anderer Annotationen sind erlaubt, wie heute.

Wortgrenzen für `Strg` + Pfeil: die nächste Position in Bewegungsrichtung, an der ein Wechsel zwischen Wortzeichen (`\p{L}`, `\p{N}`) und anderen Zeichen liegt.

---

## 4. Technik

### Span-Editor (`frontend/src/vendor/spans.js`)

- Neue Methode `setResizable(mentionIds)`: Menge der Mentions, deren Segmente Griffe bekommen. Löst ein Neuzeichnen aus.
- `render()` fügt vor dem ersten und nach dem letzten Run jedes Segments einer solchen Mention ein Element `span.resize-handle` ein, mit `data-mention`, `data-segment` (Index) und `data-edge`. Die Griffe enthalten keinen Text; ihre sichtbare Fläche ist absolut positioniert, sodass sich der Textfluss nicht verschiebt. `_offsetOf` ignoriert sie (sie sind keine `.run`-Elemente), die Offset-Berechnung beim Markieren bleibt damit korrekt.
- Zeigersteuerung über Pointer Events mit `setPointerCapture`. Die Zeichenposition unter dem Zeiger kommt aus `document.caretPositionFromPoint` (Fallback `caretRangeFromPoint`) und wird über `_offsetOf` in einen Text-Offset umgerechnet. Liegt der Zeiger außerhalb des Textes, bleibt die letzte gültige Position.
- Während des Ziehens hält der Editor eine lokale Vorschau der Segmente und zeichnet neu; `_onMouseUp` und `_onClick` werden für diesen Vorgang unterdrückt.
- Neuer Rückruf `handlers.onResize(mentionId, spans)` beim Loslassen bzw. nach der Tastatur-Verzögerung, nur wenn `resizeSegment` nicht `null` liefert.
- Ändern sich die Mentions von außen während eines Ziehvorgangs (z. B. Antwort des Servers), wird der Vorgang abgebrochen.

Die Kantenlogik (`resizeSegment`, Wortgrenzen) kommt in ein eigenes Modul `frontend/src/spans/resize.ts`, das der Editor importiert.

### Adapter (`frontend/src/spans/adapter.ts`)

- `mountSpanEditor` bekommt einen weiteren Rückruf `onResize(evidenceId, segments)` und rechnet die UTF-16-Spans wie bei `onPaint` in Codepoint-Segmente um.
- `SpanEditorHandle` bekommt `setResizable(evidenceIds: string[])`.

### Text-Bereich und Case-Screen

- `TextPane` bekommt die Props `resizableEvidenceIds` und `onResizeMention` und reicht sie durch.
- `CaseScreen` berechnet `resizableEvidenceIds` aus den `evidence_refs` der ausgewählten Annotation (leer in den oben genannten Ausnahmefällen) und schickt bei `onResizeMention` den vorhandenen Befehl

  ```json
  { "command": "edit_mention", "annotation_id": "…", "evidence_id": "…", "segments": [ { "start": 0, "end": 9 } ] }
  ```

  über die bestehende Mutations-Warteschlange. Fehler laufen über die vorhandene Fehleranzeige; nach einem Fehler zeigt der Text wieder den gespeicherten Stand.
- Review: Nach erfolgreichem Speichern läuft dieselbe Nachbehandlung wie bei anderen Änderungen an einer übernommenen Kopie (Proposal wird als „geändert" geführt, eine ausdrückliche Ablehnung bleibt bestehen). Dafür wird die vorhandene Funktion wiederverwendet, keine neue Logik.

### Aussehen

- Griff: 3 px breiter, abgerundeter Balken in der Farbe der Markierung, über die volle Zeilenhöhe, mit einer 10 px breiten unsichtbaren Greiffläche. Mauszeiger `ew-resize`.
- Fokussierter Griff: sichtbarer Fokusrahmen.
- Während des Ziehens: `user-select: none` auf dem Textcontainer.

---

## 5. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Speichern schlägt fehl | Fehleranzeige wie bei anderen Befehlen; Text zeigt den gespeicherten Stand |
| Revisionskonflikt | vorhandenes Konflikt-Banner; keine Sonderbehandlung |
| Zeiger verlässt den Text | Kante bleibt an der letzten gültigen Position |
| Mention mit ungültigen Offsets | wird schon heute nicht hervorgehoben und bekommt keine Griffe |

---

## 6. Teststrategie

**Unit-Tests (`frontend/tests/resize.test.ts`):** `resizeSegment` für Verlängern und Verkürzen an beiden Kanten, Begrenzung an der Gegenkante, Abschneiden von Leerraum, Verschmelzen mit einem Nachbarsegment, Zeichen außerhalb der Basisebene (Emoji, kombinierende Zeichen), unverändertes Ergebnis gibt `null`; Wortgrenzen in beide Richtungen.

**Komponententests (Vitest):**

- Span-Editor: Griffe erscheinen nur für `setResizable`-Mentions; Tastaturbedienung ruft `onResize` mit den erwarteten Spans; Markieren von Text liefert mit Griffen dieselben Offsets wie ohne.
- Case-Screen: Griffe nur bei ausgewählter eigener Annotation; `onResizeMention` schickt `edit_mention` mit Codepoint-Segmenten; keine Griffe bei ausgewähltem Proposal.

**Browser-Tests (Playwright, `frontend/browser/spans.spec.ts`):**

- Kante mit der Maus ziehen, danach stimmen die angezeigten Offsets der Mention und die Revision ist um eins erhöht.
- `Esc` während des Ziehens: Offsets und Revision unverändert.
- Review: „Edit" an einem Proposal, Kante der Kopie ziehen, Proposal steht als „Replaced".

**Danach:** eingebettete Web-Assets neu bauen.
