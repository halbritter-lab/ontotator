# Übergabe zur Analyse des Kandidatenrundgangs

Der Benutzer möchte die im erneuten manuellen Rundgang aufgetretenen Probleme in einer separaten Agenten-Sitzung analysieren lassen. Diese Übergabe bündelt F34–F48; das [fortlaufende Abnahmeprotokoll](2026-10-18-phase0-manual-acceptance.md) enthält die Einzelbeobachtungen, Präzisierungen und die ursprünglichen F01–F33. Die neuen Probleme wurden dokumentiert, aber nicht behoben. Ein bestandener automatisierter Test ersetzt diese menschlichen Verständlichkeitsbefunde nicht.

## Aktueller Stand bei der Sitzungsübergabe

Alle neuen Befunde F34–F48 sind gespeichert; ältere F01–F33 stehen im verlinkten Hauptprotokoll. Die Testmeldung wurde vom Benutzer fortgesetzt und anschließend als Lead abgeschlossen. Der finale Export wurde erstellt und heruntergeladen; seine Dateinamen wurden gelesen, seine wissenschaftlichen Inhalte nicht geprüft. Die neuen UX-Befunde sind nicht behoben.

Zuletzt wurde der leere Neustart angeleitet: zuerst eine neue Testmeldung als demo-annotator, danach die vereinbarte Lead-Aktion. Der Benutzer hat weder das Anlegen dieser neuen Meldung noch den Neustart bestätigt und möchte in einer anderen Sitzung fortfahren. Beides daher als **nicht bestätigt** behandeln. Vor weiterer Bedienung den realen Account- und Aufgabenstand prüfen, keine Daten zurücksetzen.

**Keine Commits und kein Push.** Dateien sind lokal gespeichert; die Übergabe ist eine neue ungetrackte Datei im vorhandenen Worktree. Derselbe Worktree muss in der nächsten Sitzung verwendet werden, damit auch die uncommitteten Implementierungsänderungen erhalten bleiben. Die folgende Darstellung enthält chronologische Zwischenstände; dieser Abschnitt ist der maßgebliche letzte Stand.

## Auftrag und Arbeitsumgebung

- Zunächst Ursachen und zusammenhängende Bedienabläufe analysieren, anschließend einen konkreten Verbesserungsvorschlag vorlegen. Aus diesem Analyseauftrag keine automatische Implementierung oder Veröffentlichung ableiten.
- **Keine Commits, kein Push.** Der Benutzer hat dies ausdrücklich erneut verlangt. Bestehende Änderungen und Benutzerdaten erhalten; kein Reset, Rebase, Cleanup oder Reseeding des Worktrees beziehungsweise der Demo.
- Arbeitsverzeichnis: `C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation`, Branch `feat/phase0-acceptance-plan`, Basis `ba0b91b4ff3c73ae8d358896957a4dd84d20d57f`.
- Kandidat: <http://127.0.0.1:18190>, Projekt `t5-acceptance`. Geschützte bisherige Demo: Port 18081. Der Benutzer hat im Kandidaten während dieses Rundgangs weitergearbeitet; alte Seed-Daten sind keine aktuelle Zustandsbeschreibung.
- Rollen im Rundgang: `demo-reviewer`, `demo-annotator`, anschließend Wechsel zu `demo-lead` angeleitet. Den tatsächlich aktiven Account vor einer Reproduktion prüfen.
- Zugangsdaten nur aus der privaten lokalen Runtime verwenden; nicht in Berichte, Screenshots oder Tool-Ausgaben kopieren. Aktueller Runtime-Zeiger: `build/t5-acceptance/full-hpo-20261018-candidate/current-runtime.json`.

## Befunde für die Analyse

| ID | Beobachtung und gewünschte Richtung | Evidenz und offene Prüfung |
| --- | --- | --- |
| F34 | „Review carried findings“ stellt dieselben Befunde zusätzlich zu „Saved findings“ dar. Zu viel Sidebar-Text, unverständliches Dropdown und vier konkurrierende Buttons, einer ohne Rand. Nicht klar, was konkret geprüft werden muss. Eine normale Befundliste mit Prüfstatus und gezielter Aktion untersuchen. | In abgegebener und neuer bearbeitbarer Runde vom Benutzer bestätigt. RoundInputPanel wird zusätzlich zur Befundliste gerendert. Der Abgabedialog hat ausdrücklich einen Review-Button; fehlende Navigation war eine falsche frühe Diagnose des Assistenten. Pflichtprüfung und explizite Auflösung müssen erhalten bleiben. |
| F35 | „Inspect original evidence“ öffnet „Original carried finding“. Zum Schließen muss bis ganz unten gescrollt werden. Schließen dauerhaft erreichbar machen. | Exakter Einstieg vom Benutzer geklärt. Close original evidence liegt im scrollenden Dialoginhalt. Nicht mit Open saved finding oder der rechten Befundansicht verwechseln. |
| F36 | Task2 zeigt „Failed Units added in translation: Synthetic check exampleunits_added“. Reviewer weiß nicht, was zu tun ist. Verständliche Erklärung, betroffene Stellen und Umgang mit berechtigten Abweichungen untersuchen. | Synthetischer Testcheck, kein nachgewiesener medizinischer Übersetzungsfehler. Keine Textstellen oder Ursachen erfinden. Technischen Code und Erklärung getrennt behandeln. |
| F37 | Runde1 unterscheidet sich optisch kaum von vorher. In der Liste „Superseded“, im Editor „Submitted“. Quelle „v1 / accepted translation“ unterscheidet Abgaben auf gleichem Text nicht. „Start carry-forward round“ unverständlich; Buttons ungünstig gestapelt. | Benutzerbeobachtung. Ablösung der Arbeitsrunde und Status ihrer Abgabe sind unterschiedliche Dimensionen und können gleichzeitig zutreffen. Die UI muss Runde, Textversion und Abgabe auseinanderhalten. |
| F38 | Problem-Dialog hat zu viel Text, zu kleines Eingabefeld und unklare Buttonhierarchie. Zwei Editor-Aktionen „Report a problem“ / „My problem reports“ erzeugen Unruhe. Benutzer befürwortet einen gemeinsamen Einstieg, schlägt „Problem?“ vor. „Reload my reports“ und Rückgängigmachen unklar. | Reload lädt nur den Stand. Eigene Pause lässt sich begründet aufheben; Meldung bleibt offen, andere Sperren bleiben wirksam. Eigene Meldung zurückziehen existiert nicht. Ein Rücknahmeablauf ist ein Vorschlag und benötigt einen geklärten Vertrag; nicht als vorhandene Funktion darstellen. |
| F39 | Zwei gleichartige „My report · open“-Blöcke mit alter synthetischer und aktueller Meldung. „Report history“ zeigt nur „resume: …“, keine Daten, Zeiten oder Person. Meldungsstatus und Aufgabenpause kaum unterscheidbar. | Event-Zeitstempel werden bereits geliefert, aber nicht gerendert. Actor ist gespeichert, im Event-View nicht geliefert. Erstellung ist gespeichert, aber nicht im derzeitigen Report-View bzw. gezeigten Aktionsverlauf repräsentiert. Chronologie einschließlich Erstellung, verständliche Aktionen und eindeutiger aktueller Zustand nötig. |
| F40 | My tasks bietet kein Projekt im lokalen Selektor, oben rechts Choose project bietet es dagegen an. | Beobachtet beim angeleiteten Lead-Wechsel. Noch nicht reproduziert. Aufgabenfilter versus globale Projektmitgliedschaft sowie veralteter Zustand nach Accountwechsel getrennt prüfen. Ein Lead ohne eigene Aufgaben ist eine mögliche Erklärung, kein bestätigter Fehlergrund. |
| F41 | Choose-project-Popup verschwindet nicht wieder. | Benutzerbeobachtung ohne bestätigten Auslöser. Auswahl, Außenklick, Escape, erneutes Betätigen, Fokus und Routenwechsel gezielt prüfen. Nicht mit dem früher behobenen Clipping verwechseln. |
| F42 | Dokumentbaum zwar strukturierter, aber „nur Text Baum“, weiterhin völlig unübersichtlich. Benutzer fordert eine Tabelle. | Tabelle mit ausgerichteten Spalten und aufklappbarer Hierarchie als Richtung untersuchen. Die fachliche Hierarchie wurde nicht verworfen. Exakte Versionen, Ergebnisse, Auswahlstatus, unabhängige Übersetzungen und Herkunft erhalten. Spalten und schmale Ansichten noch entwerfen. |

### Präzisierungen zur Tabelle und Meldungssuche

F42: ausdrücklich eine Tabelle mit aufklappbaren Children, letzter Änderung mit Datum/Uhrzeit, Versionsstatus, Öffnen-Link/Button sowie verständlichen Status-/Fehlersymbolen. Die Bedeutung der letzten Änderung pro Zeilentyp klären; Symbole mit zugänglichen Beschriftungen versehen.

F43: Der Benutzer findet die aktuelle Meldung als Lead nicht. Tatsächlicher Einstieg ist **Progress → Final results and open issues**, nicht eine separate Dashboard-Seite. Dort werden offene Meldungen nur als “An open problem report needs a lead decision.” / “Review issue” angezeigt, ohne Beschreibung der konkreten Meldung. Mehrere Meldungen desselben Falls sind so kaum unterscheidbar. Die frühere Wegbeschreibung des Assistenten war ungenau. Quellstellen: `frontend/src/admin/ProgressPage.tsx`, `ProjectDashboardPage.tsx`, Warnungsprojektion in `src/ontocurator/storage/repository.py`. Aktuelle Meldungs-ID per gezieltem Read-only-Lookup bestätigt: `report-d9331b626756409ba3b803403ef88e44`. Direkter Lead-Link: <http://127.0.0.1:18190/#/projects/t5-acceptance/problem-reports/report-d9331b626756409ba3b803403ef88e44>. Keine Aktion an der Meldung vorgenommen.

## Bestätigte Abläufe und aktueller Arbeitsstand

Der Benutzer bestätigte die Orientierung in Task1 `ready-translation`, eine Korrektur mit Review-Notiz sowie deren Erhalt und Schreibschutz nach Abgabe und Neuladen. Die genaue neue Versionskennung wurde nicht ausgelesen. Task2 `failed-translation` sollte unverändert bleiben; der synthetische Check wurde als Verständlichkeitsproblem erkannt.

In Task4 `accepted-translation` startete der Benutzer eine neue Übernahmerunde. Die genaue Rundennummer und gewählte Ausgangsabgabe sind nicht verifiziert. Die Runde wurde bearbeitbar. Markierung und deutsche Suche „Hypotonie“ lieferten den erwarteten Befund Hypotonia / HP:0001252. Achsen waren zunächst überall „Not specified“; konfigurierte Erzeugungsdefaults wurden damit nicht getestet. Explizit gewählte Achsen blieben beim Befundwechsel erhalten, die Textansicht blieb stabil.

Beim Abgabeversuch wurde eine ausstehende Übernahmeprüfung gemeldet. Deren Abschluss und eine neue Abgabe sind nicht bestätigt. Der Benutzer meldete: „Testmeldung: Bei der übernommenen Annotation ist unklar, was erneut geprüft werden muss. Bitte mit der Projektleitung klären.“ Anschließend setzte er die Aufgabe mit Begründung „upsi“ erfolgreich fort; Arbeitsstand blieb erhalten. Die aktuelle und eine frühere synthetische Meldung wurden danach beide als offen angezeigt. Nicht als gelöst oder zurückgezogen verbuchen.

Der Rundgang steht jetzt beim angeleiteten Wechsel zur Projektleitung. Projektauswahl und Dokumentübersicht haben neue Probleme sichtbar gemacht. Lead-Auflösung, vereinbarter leerer Neustart, Konsolidierung und finale Auswahl/Export wurden in diesem Benutzerrundgang noch nicht erfolgreich durchlaufen. Vorherige automatisierte oder agentengesteuerte Nachweise bleiben separat.

## Bereits bekannte Quellstellen und Vorarbeiten

- `frontend/src/tasks/RoundInputPanel.tsx`, `frontend/src/app/CaseScreen.tsx`: doppelte Übernahme-/Befunddarstellung und Abgabesperre.
- `frontend/src/tasks/RoundInputEvidenceDialog.tsx`, `frontend/src/ui/Dialog.tsx`: Originalbefund und vorhandener fester Dialog-Footer.
- `frontend/src/tasks/TaskProblemActions.tsx`, `ProblemReportForm.tsx`, `ReportHistory.tsx`, `ProblemReportDetail.tsx`: Meldungseinstiege, Texte, Eingabe, Aktualisieren, Fortsetzen und Lead-Aktionen.
- `src/ontocurator/application/problem_reports.py`: Berechtigungen, Pause, Ereignisse und Report-View.
- Für F40–F42 zunächst die konkreten My-tasks-/Shell-Selektoren und Dokumentlisten-Komponenten lokalisieren. Noch keine Ursache als bestätigt ausgeben.
- [Implementierungsübergabe](2026-10-19-acceptance-implementation-handoff.md), [UX-Synthese F01–F33](2026-10-19-acceptance-ux-review.md), [Workflow-Verträge](../specs/2026-10-18-acceptance-workflow-contracts.md), [ursprünglicher Plan](../plans/2026-10-18-acceptance-remediation.md).

## Erwartetes Ergebnis der separaten Sitzung

Die Befunde zu wenigen zusammenhängenden Problemen bündeln: eindeutige Arbeits-/Prüfführung, verständliche Meldungsbehandlung mit Historie sowie konsistente Projekt- und Dokumentnavigation. Direkte Benutzerbeobachtungen von vermuteten Ursachen trennen; nur offene Ursachen gezielt reproduzieren. Vorhandene Reviews und Testnachweise verwenden statt komplette Analysen oder Tests zu wiederholen.

Für jede vorgeschlagene Änderung den normalen Weg, den Ausnahmefall, sichtbare Statusübergänge und erhaltene Sicherheits-/Datenverträge beschreiben. Besondere offene Verträge sind die Rücknahme eigener Meldungen und der Umgang mit weiteren aktiven Sperren. Keine automatische klinische Bestätigung, keine still ersetzte finale Auswahl und kein Verlust historischer Arbeit. Die gewünschte Tabellenansicht konkret entwerfen. Noch keinen weiteren Implementierungsdurchlauf beginnen.

## Kandidatenidentität beim Dokumentieren

Image: `sha256:308835c746dc36e943285e3faea2486743468295fa4abaa47365e8d8d3a45326`. Source-Snapshot: `3e2af6fef37d9872e0b443e8def9ac84e4287d91935af4526fe6b0d560b1390f`. Diese Identität beschreibt den Code, nicht den inzwischen durch den Benutzer weiterentwickelten Datenstand.

## Weitere Beobachtung zur Meldung und Größenänderung

F43: Die deutsche Meldung ist weiterhin unter der angegebenen ID gespeichert, Wortlaut: „Testmeldung: Bei der übernommenen Annotation ist unklar, was erneut geprüft werden muss. Bitte mit der Projektleitung klären.“ Der Benutzer findet sie weiterhin nicht. Noch klären, ob er auf Progress oder der Detailroute ist. Englischen allgemeinen Warnungstext, ältere synthetische Meldung und aktuelle deutsche Meldung unterscheiden.

F44: Die linke Editor-Spalte soll vom Benutzer in der Breite veränderbar sein. In den Entwurf aufnehmen: erkennbare und per Tastatur bedienbare Trennlinie, sinnvolle Grenzen, Zusammenspiel mit Text-/Detailspalte und mobilen Tabs sowie Entscheidung über Speicherung/Zurücksetzen der Breite. Nur die Größenveränderbarkeit wurde ausdrücklich angefordert; diese Einzelheiten sind noch zu gestalten. Bewusstes Vergrößern darf den Text neu umbrechen, gewöhnliche Befundauswahl weiterhin keine überraschenden Layoutsprünge auslösen. Noch nicht implementiert.

## Lead Aktionen und bestätigte Erreichbarkeit

F43 präzisiert: Über den direkten Link sieht der Benutzer seine deutsche Meldung. Die Detailansicht selbst fehlt also nicht; Auffindbarkeit und die generischen gleichartigen Warntexte sind das bestätigte Problem.

F45: Die vier Lead-Aktionen im Report-action-Dropdown sind dem Benutzer nicht verständlich, besonders Meldung abschließen versus Pause aufheben. Aktuell schließt Resolve nur die Meldung; Resume hebt ausgewählte Sperren dieses Reports auf, ohne die Meldung zu schließen; Extend hold pausiert ausgewählte weitere Aufgaben; Restart erzeugt nach Vereinbarung eine neue leere Runde und erhält die alte Historie. Andere aktive Sperren und eine explizite finale Auswahl dürfen nicht still aufgehoben/geändert werden. Die aktuelle Aufgabe wurde bereits vom Benutzer fortgesetzt. Einen an Absichten orientierten Ablauf mit sichtbarem Ist-Zustand, passenden Aktionen und klaren Folgen entwerfen. Zusammenlegen von Abschluss und Freigabe ist noch keine beschlossene Vertragsänderung. Keine Umsetzung erfolgt.


Aktueller Fortgang: Benutzer bestätigt den erfolgreichen Abschluss der Testmeldung als Lead. Ob die Warnung anschließend aus Progress verschwand, blieb ungeprüft, weil er die relevante Stelle nicht fand (F43). Als nächstes wird die finale Ergebnisauswahl betrachtet; keine neue Auswahl oder Exportaktion im Benutzerrundgang bestätigt.

## Finale Auswahl im Historien Dialog unverständlich

F46: Benutzer öffnete den Submissions-Dialog für `synthetic-accepted / de / accepted-translation` und bezeichnet ihn als „völlig unbrauchbar“, weil das Wesentliche nicht erkennbar ist. Vollständiger sichtbarer Text ist im Hauptprotokoll unter F46 gespeichert. Der Dialog vermischt Historie, finale Auswahl, Kontextwarnung mit Checkbox/Bestätigung, Ersetzung per Dropdown und Konsolidierung. Oben steht `Selected: sub-f568003ee202f17a · text accepted-translation`, darunter zwei Zeilen von `ann-0004` am 19.10.2026 um 00:57 und 00:16 mit langen Round-IDs und „independent“. Die ausgewählte Abgabe ist in den Zeilen nicht eindeutig markiert; Unterschiede sind nicht ersichtlich. Keine Auswahländerung oder Bestätigung erfolgte.

Mit F37/F42 gemeinsam analysieren: vergleichbare Abgabetabelle mit sichtbarer Auswahlmarkierung, verständlicher Identität, Datum/Uhrzeit und Öffnen/Vergleichen; konkrete Warnung am betroffenen Ergebnis; eine klare bewusste Auswahlaktion nach Prüfung. Technische IDs unter Details, Konsolidierung als gesonderter optionaler Ablauf. Zeitstempel nicht als Qualitätsentscheidung behandeln; keine Unterschiede erfinden, keine automatische Übernahme der neuesten Abgabe. Reaffirmation bleibt explizit und an konkrete Ursachen gebunden. Dieser Vorschlag ist noch kein implementiertes oder vollständig abgestimmtes Design.

## Exportprüfung ohne lokalen Rückweg

F47: Export grundsätzlich als einigermaßen ordentlich bewertet, aber etwas textüberladen. Nach Review final export fehlt ein Rückweg zum vorherigen Seitenzustand. Bestätigt in `frontend/src/admin/FinalExportPanel.tsx`: Inline-Preflight hat keine Abbrechen-/Schließen-Aktion; Return to results führt zu Documents. Der Preflight liest lediglich die aktuelle Projektion (`FinalResultService.preflight`); erst Create final export startet den Export. Keine Exporterzeugung im Benutzerrundgang bestätigt. Vorschlag: Vorbereitung klar benennen, lokal abbrechen/schließen können und dabei die vorläufige Warnungsbestätigung zurücksetzen. Keine Umsetzung erfolgt.

## Erfolgreicher Exportdownload im Benutzerrundgang

Der Benutzer hat inzwischen die Exporterstellung und den Download bestätigt. Genannter Name im Downloads-Ordner: `t5-acceptance-final-20261019T073714Z`. Frühere Aussagen in dieser chronologischen Übergabe, dass noch kein Export bestätigt sei, sind damit überholt. Die Inhalte dieses konkreten Artefakts und seine Warnungs-/Auslassungsbelege wurden noch nicht geprüft; frühere automatisierte Exportnachweise sind davon getrennt. F47 zum fehlenden lokalen Abbrechen der Vorprüfung bleibt bestehen. Keine Commits.

## Exportnamen nicht selbsterklärend

F48: Benutzer findet die Dateinamen kryptisch. Nur Namen des konkreten Downloads read-only geprüft: außen `selected.t1.zip`, `source-texts.jsonl`, `receipt.json`; im inneren ZIP `manifest.json`, `documents/00000.json`. Keine wissenschaftliche Inhaltsprüfung, keine Änderung oder Extraktion. Eine lesbare Übersicht fehlt. Einen menschlich verständlichen Index mit Text/Sprache/Version/gewählter Abgabe, Dateizuordnung und Warnungen/Auslassungen sowie kurzer Formaterklärung entwerfen. Interne T1-/ontospan-Dateinamen und Referenzen nicht ungeprüft umbenennen; maschinelle Austauschverträge bleiben erhalten.
