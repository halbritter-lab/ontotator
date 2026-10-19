# Überarbeiteter Plan: zweite Reviewrunde

Stand 2026-10-18, `feat/phase0-acceptance-plan`, Codebasis `ba0b91b`. Nur Planung und Review; keine Anwendung geändert, keine Tests ausgeführt, keine Demoänderung, kein Commit/Push.

## Überarbeitung vor den Reviews

Der [Plan](../plans/2026-10-18-acceptance-remediation.md) übernimmt die bestätigten Befunde der ersten Runde:

- Konkrete Aktion–Ansicht–Berechtigung–Zuständigkeit für Lead und Aufgabenbearbeiter.
- Autorisiertes Backend für Abgabehistorien sowie bewusster UI/API-Pfad für erneute Übersetzungskorrektur.
- Serverseitige Kennzeichnung voreingestellter Achsen, explizite Bestätigung und revisionsgebundene Warnungsannahme.
- Kompakter technischer Prüfpunkt mit Kriterien für Rundenidentität, Assignment-Zuordnung, parallele Änderungen, private Übernahme, Zusammenführung, Herkunft, Quelländerungen und eingefrorene Exporte.
- Zuständigkeiten/Abhängigkeiten und kleinere sachliche Korrekturen; der erste Exportfix bleibt unabhängig von den neuen Workflows.

## Unabhängige Reviews

Beide prüften Plan-SHA256 `40E8D1F2D5B27A46E9AE8A0E5AFB6DF02A4162777EC36956745A58DA932B044D` und Protokoll-SHA256 `2F5A3107813C5869348F8AF445BC5C9EC859BA80D18117903E96046C81F73D58`.

- [Codex Sol 6.1 high](2026-10-18-acceptance-revised-codex-review.md): keine neuen wesentlichen P1/P2-Planbefunde. Die bisherigen Lücken sind adressiert; die ausdrücklich offenen technischen Verträge bleiben Voraussetzung der neuen Pakete.
- [Antigravity Gemini 4 Argon High](2026-10-18-acceptance-revised-argon-review.md): erfolgreicher Lauf mit sechs Befunden. Bericht enthält erneut falsche Zitate und Zuordnungen; seine Schweregrade/Bereitschaftstabelle sind nicht als Gesamturteil übernommen.

## Prüfung der Argon-Befunde

| Befund | Einordnung |
| --- | --- |
| 1: Vorgängerstatus nach Übersetzungskorrektur | Tatsächliche Wechselwirkung, aber bereits ausdrücklich in Task 10 enthalten: `next_status`-Auswirkungen auf historischen Zugriff und angeheftete Auswahl testen. Der tatsächliche Entscheidungscode heißt `accepted_corrected`, nicht `accepted_with_corrections`. Kein neuer unberücksichtigter Blocker. |
| 2: Menschliche Eingaben statt Vorschlagsinventar | Bereits in mehreren Checkpoint-Zeilen und Task 10 enthalten, ausdrücklich einschließlich open/adopt/decide/submit/export und Herkunftskollisionen. Die Behauptung, Reviews seien nicht zugeordnet, trifft den Plan nicht. Keine weitere Architekturvorgabe übernommen. |
| 3: Separater Übersetzungseditor bei Hold | Backend-Abdeckung bereits im Checkpoint; als enge Klarstellung die konkreten Frontend-/Route-/Service-Dateien und Save-/Submit-Tests in Task 11 ergänzt. Das angebliche Plan-Zitat mit pauschaler Meldungsbefugnis für Lead/Admin existiert nicht; keine solche Rechteausweitung übernommen. |
| 4: ScopedRepository und Datenbankrechte | Bestätigt durch `authz/scoped.py`, `tests/test_project_scope.py` und die Schema-/Migrationskonventionen. Als gemeinsame Anforderung für Tasks 7/10–12 ergänzt: Wrapper-Parität, APP_ROLE-Rechte, passende Unveränderlichkeit und Prüfung unter App-Rolle. Keine pauschale Append-only-Kennzeichnung für mutable Workflow-Tabellen. |
| 5: Zugang zu eigenen Abgaben | Präventive Anforderung für den Umbau: `useVersionAccess` sperrt die separaten Versions-/Vergleichscontrols, aber die bestehende Previous-Submissions-Ansicht in `CaseScreen.tsx` ist davon unabhängig. Kein nachgewiesener aktueller Verlust eigener Historie. Task 7 mit Task 3 erhält diesen Zugriff ausdrücklich für Annotator-only-Konten. Keine Ausweitung auf allgemeines Projekt-Browsing; der Bericht ordnet den Hook fälschlich `versionState.ts` zu. |
| 6: Falsche Dateinamen / Termbestätigung | Zurückgewiesen: Der Plan enthält weder `ProjectCreatePage.tsx` noch `admin/ProfilePage.tsx` noch die behauptete generelle Termwechselbestätigung. Keine Änderung daraus. |

Auch die behaupteten fixen Spaltenbreiten, UI-Lokalisierung und vollständige Startbereitschaft von Task 8 sind nicht beschlossen. Task 13 bleibt eine isolierte Kandidatenvorbereitung, kein Austausch der laufenden Demo.

## Abschließender Stand

Nach den beiden Reviews wurden nur die drei oben benannten Klarstellungen (Scope/DB-Rechte, eigener Historienzugang, separater Übersetzungspfad) und der Review-Verweis ergänzt. Diese Änderungen sind von der vollständig unabhängig geprüften Fassung unterscheidbar; Codex erhielt dafür eine begrenzte Nachprüfung statt einer weiteren Vollrunde.

Die Codex-Nachprüfung bestätigt alle drei Ergänzungen ohne neue Befunde oder Änderung der Bereitschaftseinschätzung. Finaler Plan-SHA256: `117F1CE2E4F629F055B73372BC49385308FD8E37B2C24566169F95636F588292`. Dokumentprüfung: F01–F33 jeweils einmal, Tasks 1–14 vollständig, lokale Planlinks gültig, `git diff --check` ohne Fehler (nur vorhandener CRLF-Hinweis).

Der Plan ist als konsolidierte Arbeitsgrundlage geeignet. Offen bleiben die benannten Entscheidungen: Pflichtprüfung unveränderlicher/unbelegter Achsen, technische Runden-/Exportverträge, Erstkonfiguration der Sprachpräferenzen, genaue Warnungsabdeckung/leerer Export und konkrete Symbole. Sie sind keine Implementierungsfreigabe. Bestehende Korrekturen können nach Freigabe getrennt beginnen; Tasks 10–12 benötigen zuerst das Vertragsaddendum.
