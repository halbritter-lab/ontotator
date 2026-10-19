# Konsolidiertes Planreview: Codex, Claude und Antigravity

Stand: 2026-10-18, Branch `feat/phase0-acceptance-plan`, Codebasis `ba0b91b`. Drei unabhängige Reviews des gleichen lokalen Plan-/Protokollstands. Der Plan wurde während der Reviews nicht geändert. Dies ist eine Auswertung, keine Implementierungsfreigabe und keine abgeschlossene Abnahme.

## Berichte und Nachvollziehbarkeit

- [Codex Sol 6.1 high](2026-10-18-acceptance-consolidated-codex-review.md): zwei konkrete P2-Planlücken; offene Verträge ausdrücklich separat behandelt.
- [Claude Code Opus high](2026-10-18-acceptance-consolidated-opus-review.md): erfolgreicher CLI-Lauf, tatsächliches Modell `claude-opus-5-5`; zusätzliche Anforderungen an die bestehenden technischen Prüfpunkte.
- [Antigravity Gemini 4 Argon High](2026-10-18-acceptance-consolidated-argon-review.md): erfolgreicher CLI-Lauf mit `gemini-4-argon-high`, Effort high; Backend-Auswahl im Log bestätigt. Mehrere falsche Plan-/Codezuordnungen begrenzen die Verlässlichkeit dieses Berichts.

Plan SHA256: `9A6AF0EB21408E9C77199EE30B9C290AD81F96C2157675C1A4BF25BC22B93075`.
Protokoll SHA256: `2F5A3107813C5869348F8AF445BC5C9EC859BA80D18117903E96046C81F73D58`.

## Bestätigte Ergänzungen zur Planung

| Punkt | Bewertung und nächster Planungsschritt |
| --- | --- |
| Wiederholte Übersetzungskorrektur | Codex R1 bestätigt: `assignmentUI.tsx::canReviewSelection` sperrt akzeptierte Übersetzungen zusätzlich zum Backend. Task 10 muss eine bewusste Bedienaktion und deren UI-/API-Test übernehmen; keine pauschale Freigabe in der Verteilung. |
| Neue Bedienwege | Codex R2 bestätigt: Tasks 10–12 brauchen konkrete Ziele für Zusammenführung starten, neue Runde öffnen, unveränderte Übersetzung gegenüber einer bestimmten Quelländerung bestätigen sowie Report/Hold/Neustart bearbeiten. Eine kleine Aktion–Ansicht–Berechtigung-Tabelle reicht. |
| Abgabehistorie im Textbaum | Claude M1 bestätigt: `authz/versions.py::visible_annotation_versions` liefert eigene Abgaben und Vorschläge, keine allgemeine Lead-Historie. Task 7 braucht einen autorisierten Datenzugriff oder eine ausdrückliche spätere Erweiterung durch Task 12. Unabhängige Annotatoren dürfen dadurch keine fremden Ergebnisse sehen. |
| Unbestätigte Voreinstellungen | Claude H5 konkretisiert Task 8: `_create_annotation` speichert neue, nicht übernommene Werte derzeit mit leerem `axes_defaulted`. Defaults und bewusste Auswahl müssen serverseitig unterscheidbar sein; Test bis zum T1-Export mit `basis: defaulted`. Die Bedeutung von Pflichtprüfung für Achsen ohne Voreinstellung bleibt zu klären. |
| Kleine Planpräzisierungen | Neue Datei `axisLabels.ts` als vorgeschlagen markieren; gemeinsame Settings-/CaseScreen-Zuständigkeiten und Reihenfolge ergänzen; bestehende Diff-Invariantenkommentare beim späteren Fix bewusst anpassen. Exportfehler nicht aus Python-Repräsentationen parsen. |

## Bestehende technische Prüfpunkte konkretisieren

Diese Risiken sind keine neu entdeckten Produktentscheidungen. Der Plan nennt sie bereits als Voraussetzung für Tasks 10–12; die Reviews liefern nützliche Abnahmekriterien:

1. **Rundenidentität und Sperren:** Eigene Identität für Entwurf, Herkunft und Revisionsfolge; alte Runden bleiben lesbar, aber nach Ablösung nicht weiter beschreibbar. Zuordnung zwischen Assignment und mehreren Runden festlegen. `uq_assignments_active`, Workspace-Aliase, Wiederherstellung aus Abgaben, Mutation-Receipts und Export berücksichtigen. Zwei gleichzeitige Sitzungen dürfen Hold/Neustart nicht umgehen.
2. **Private Übernahme und Zusammenführung:** Modus, Auslöser, exakte Eingabeabgaben und Zugriff festlegen. Vorhandene Reanchor-Funktionen sind auf Review und dokumentweite Vorschläge zugeschnitten. Menschliche Eingaben brauchen durchgängige Auflösung beim Öffnen, Übernehmen, Abgeben und Exportieren, einschließlich Herkunft und möglicher ID-Kollisionen. Keine pauschale Veröffentlichung persönlicher Annotationen.
3. **Problemmeldung und Hold:** Zustandsübergänge inklusive Meldung nach Abgabe, Fortsetzung und sauberem Neustart definieren. Eine auf andere Aufgaben ausgeweitete Sperre darf keine privaten Annotationsinhalte aus der ursprünglichen Meldung offenlegen.
4. **Quelländerungen und Übersetzungen:** Alle Entstehungswege einer Quellkorrektur erfassen oder Verpflichtungen aus unveränderlichen Versionen ableiten. Historische Übersetzungsquelle erhalten; zusätzlich genau dokumentieren, gegen welches neue Original geprüft wurde. UI und Export müssen beide Beziehungen korrekt unterscheiden.
5. **Finaler Export:** Bestätigten Auswahl-/Warnungsstand bei Auftragserstellung prüfen und für den Job einfrieren. Herkunft menschlicher Eingaben und konsolidierter Ergebnisse ausdrücklich abbilden. Legacy-/CLI-Export bewusst abgrenzen. Völlig leeren Export und erwartete Sprachabdeckung weiterhin als offene Detailentscheidung behandeln.

## Nicht ungeprüft übernehmen

- Claudes H3 ist kein Grund, Task 1 aufzublähen: Der bestehende Provenienzfehler kann mit dem heutigen Vorschlagsinventar repariert werden. Die Erweiterung auf menschliche, eingefrorene Eingaben gehört explizit zu Tasks 10/12.
- Claudes konkrete Vorschläge für neue Workspace-Felder, Aufgabenarten oder obligatorische Reviewer-Ausschlüsse sind mögliche Lösungen, keine beschlossenen Produkteigenschaften. Bestehende konfigurierbare Rollenpolitik beachten.
- Argon benennt mehrere Tasks und Records falsch: Multilingualität ist Task 9, Integration Task 14; der aktuelle Plan verwendet `ProblemReport`, `FinalSelection` und `WorkflowWarning`. Seine Bereitschaftstabelle ist daher nicht verwendbar.
- Argon M1 ist sachlich falsch: Die behauptete Token-Diff-Funktion in `exchange/reanchor_job.py` existiert nicht. Tatsächliche Zeichenvergleiche stehen in `domain/reanchor.py` (u. a. Zeile 179). Daraus folgt keine Pflicht, den Fehler ausschließlich serverseitig zu beheben. Der geplante TDD-Fix für die Darstellung bleibt bestehen.
- Argon C4 behauptet eine nicht vorhandene Reopen-Sperre für Übersetzungsreviews. `AssignmentService.reopen` erlaubt den allgemeinen Submitted→Reopened-Pfad. Die tatsächlich vorhandene Accepted-Zuweisungssperre bleibt relevant. `next_status` setzt einen korrigierten Vorgänger tatsächlich auf `reviewed`; Auswirkungen auf vorhandene Auswahl/Zugriff sollten im Vertragscheck geprüft werden, historische Review-Datensätze bleiben jedoch erhalten.
- Argons Forderungen nach neuen Projekt-Regeldefaults, dauerhaft identischer Shell-Navigation und zusätzlichen Anzeigepräferenzen sind nicht durch dieses Review autorisiert. Die schmalere linke Annotationsliste darf nicht mit der globalen Navigation verwechselt werden.
- Argons Vorschlag eines bloßen Export-Bestätigungsbooleans ersetzt keine Bindung an exakte Warnungen und Auswahlrevisionen.

## Ergebnis und Fortsetzung

Das Produktmodell bleibt tragfähig. Bestehende Fehlerkorrekturen und UI-Pakete können nach Umsetzungsfreigabe separat beginnen. Vor Tasks 10–12 ist ein kompakter technischer Vertrag nötig; Task 8 benötigt die bestätigbare Default-/Pflichtprüfungssemantik. Die zwei UI-Lücken und der Lead-Historienzugriff müssen im Plan ergänzt werden.

Nächster sinnvoller Planungsschritt: diese bestätigten Ergänzungen einarbeiten und anschließend die bereits offenen Verträge abschnittsweise entscheiden. Keine erneute komplette Reviewrunde nötig, solange sich das Modell nicht wesentlich ändert.

Nur Dokumente erstellt; keine Anwendung geändert, keine Tests ausgeführt, keine Demo angefasst, kein Commit oder Push. Die Einzelberichte enthalten unübernommene Empfehlungen; diese Auswertung bestimmt ihre Einordnung.
