# Design: Durchgehende linke Leiste und AI-Badge

**Datum:** 2026-10-07
**Status:** Entwurf zur Prüfung
**Thema:** Platznutzung der linken Leiste im Case-Screen und sichtbare Kennzeichnung maschinell erzeugter Annotationen

---

## TL;DR

- **Linke Leiste:** Proposals, Referenzen und kuratierte Annotationen scrollen gemeinsam in einem Bereich; die 40-%-Deckelung der Proposal-Liste entfällt. Abschnittsüberschriften kleben oben, Layer-Steuerung und Fußbereich bleiben fest. Der ausgewählte Eintrag wird automatisch ins Bild gescrollt.
- **AI-Badge:** Jede Annotation mit Herkunft `tool` zeigt ein violett-magentafarbenes Badge „✦ AI" (ohne Animation, Tooltip mit Tool-Name und Methode) in der Proposal-Liste, bei Referenz-Annotationen und in den Details rechts.
- **Kein Badge** auf kuratierten Annotationen, auch nicht auf übernommenen: Die gelten als geprüft.
- **Unverändert:** Paketformat, API, Inhalt und Klickverhalten der Einträge, mobile Ansicht.
- **Nicht enthalten:** Spans per Ziehen anpassen und die Term-Suche; beide bekommen eigene Specs.

---

## 1. Ziel und Umfang

Beim Review von AI-generierten Annotationen fallen zwei Dinge auf:

1. Die linke Leiste nutzt ihren Platz schlecht. Die Proposal-Liste ist auf 40 % der Höhe gedeckelt und scrollt, während der Bereich der kuratierten Annotationen darunter leer bleibt.
2. Die Herkunft einer Annotation steht nur als Text „tool" in der Liste. Maschinell erzeugte Annotationen sollen auf einen Blick erkennbar sein.

Nicht Teil dieses Designs: Spans per Ziehen anpassen, Term-Suche (Übersetzungen, Hierarchie-Navigation). Beide bekommen eigene Specs.

---

## 2. Linke Leiste: ein Scrollbereich

### Aufbau

Die Leiste (`aside.sidebar` in `frontend/src/app/CaseScreen.tsx`) besteht künftig aus drei Zonen:

| Zone | Inhalt | Verhalten |
|---|---|---|
| Kopf | `LayerControls` | fest, scrollt nicht |
| Mitte | Review Proposals, Reference Annotations, Curated Annotations | **ein** gemeinsamer Scrollcontainer |
| Fuß | Previous Submissions, Verified-Anzeige, Submit-Fehler | fest, scrollt nicht |

### Regeln

- Der mittlere Container ist der einzige Scrollcontainer der Leiste (`overflow-y: auto`, `flex: 1`, `min-height: 0`). Die Listen darin (`ul.doc-list`) scrollen nicht mehr selbst; die Inline-Deckelung `maxHeight: "40%"` der Proposal-Liste entfällt.
- Die drei Abschnittsüberschriften („Review Proposals (n)", „Reference Annotations (n)", „Curated Annotations (n)") sind `position: sticky; top: 0` mit deckendem Hintergrund. Der Knopf „+ New Annotation" sitzt in der Überschrift der kuratierten Annotationen und bleibt damit erreichbar, sobald dieser Abschnitt im Bild ist.
- Abschnitte ohne Inhalt verhalten sich wie bisher: Proposals nur im Review-Modus, Referenzen nur wenn vorhanden, kuratierte Annotationen immer.
- Auswahl bleibt sichtbar: Ändert sich die Auswahl (Proposal, Referenz oder kuratierte Annotation), wird der zugehörige Listeneintrag mit `scrollIntoView({ block: "nearest" })` ins Bild geholt. Das gilt für Klicks im Text, „Replaced by", „Jump to target" und Tastaturnavigation. Ein Klick auf den Eintrag selbst löst dadurch keine sichtbare Bewegung aus.
- Reihenfolge, Inhalt und Klickverhalten der Einträge bleiben unverändert. Die mobile Ansicht (Tabs List / Document / Details) bleibt unverändert; dort scrollt derselbe mittlere Container.

---

## 3. AI-Badge

### Regel

Eine Annotation gilt als maschinell erzeugt, wenn `provenance.actor.kind === "tool"`. Dann wird ein „AI"-Badge gezeigt; bei `"human"` nicht. Das Paketformat und die API bleiben unverändert.

Bekannte Unschärfe: Auch regelbasierte Pipelines sind `tool` und bekommen das Badge. Das ist akzeptiert; eine feinere Unterscheidung würde ein neues Feld im Paketformat brauchen und ist nicht Teil dieses Designs.

### Komponente

Neue Komponente `frontend/src/editor/AiBadge.tsx`:

- Eingabe: `provenance` (Typ `Provenance` aus der generierten API).
- Rendert nichts, wenn `actor.kind !== "tool"`.
- Sonst ein `<span class="badge badge-ai">` mit Text „✦ AI", `title` und `aria-label` „AI-generated: {actor_id} · {method}".

### Orte

| Ort | Heute | Neu |
|---|---|---|
| Proposal-Liste (linke Leiste) | Text „• tool" bzw. „• human" in der Meta-Zeile | Badge statt „• tool"; „• human" bleibt als Text |
| Reference Annotations (linke Leiste) | keine Herkunftsangabe | Badge neben dem Layer-Namen |
| Review-Details (`ReviewActions.tsx`, Zeile „Source") | „Source: **tool** (actor_id) • Method: …" | Badge vor der Zeile; Text bleibt ausgeschrieben |
| Referenz-Details (rechte Spalte) | „actor_id · method" | Badge vor der Zeile |

Kuratierte Annotationen bekommen **kein** Badge, auch wenn sie aus einem AI-Proposal übernommen wurden: Eine übernommene Annotation ist geprüft und dem Annotator zugeschrieben.

### Aussehen

- `.badge-ai`: Verlauf Violett → Magenta (`linear-gradient(135deg, #7c3aed, #db2777)`), weiße Schrift, `font-weight: 600`, gleiche Größe wie die Entscheidungs-Badges in der Proposal-Liste (0.72rem).
- Keine Animation. Bei Dutzenden Proposals in der Liste würde Bewegung ablenken.
- In erledigten (ausgegrauten) Proposal-Einträgen erbt das Badge deren reduzierte Deckkraft.

---

## 4. Teststrategie

**Komponententests (Vitest, `frontend/tests/`):**

- `AiBadge`: rendert bei `kind: "tool"` mit Tooltip aus `actor_id` und `method`; rendert nichts bei `kind: "human"`.
- Case-Screen im Review-Modus: Tool-Proposal zeigt das Badge und keinen Text „• tool"; Human-Proposal zeigt kein Badge.
- Case-Screen: kuratierte Annotation mit `source_refs` auf ein Tool-Proposal zeigt kein Badge.
- Case-Screen: die Leiste enthält genau einen Scrollcontainer, der alle drei Abschnitte umschließt; die Proposal-Liste hat keine `max-height` mehr.
- Auswahlwechsel ruft `scrollIntoView` auf dem passenden Eintrag auf.

**Browser-Test (Playwright, `frontend/browser/`):**

- Paket mit vielen Proposals: Die kuratierten Annotationen sind durch Scrollen der Leiste erreichbar, und die Überschrift des gerade sichtbaren Abschnitts bleibt am oberen Rand stehen.

**Danach:** eingebettete Web-Assets neu bauen (`src/ontocurator/web`), wie bei den bisherigen Frontend-Änderungen.
