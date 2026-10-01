# Lokaler HPO-Editor: erster durchgängiger Arbeitsablauf

Datum: 2026-10-01

Status: Planungsgrundlage. Produktumfang, herkunftsunabhängige Bedienung und
Python-Backend wurden im Gespräch bestätigt; am 2026-10-01 wurde ausdrücklich
ein Implementierungsplan mit Python beauftragt. Die übrigen technischen Details
sind Planungsvorschläge, noch keine freigegebene Implementierung.

## 1. Bestätigtes Ziel

Eine eigenständige Anwendung in einem eigenen Repository unterstützt die
ärztliche Erstellung und Prüfung von HPO-Annotationen. Sie läuft lokal im
Browser mit einem lokalen Backend. Daten bleiben auf dem jeweiligen Rechner;
Arbeitspakete werden als Dateien ausgetauscht.

Der erste Stand umfasst unabhängige Annotation und die Prüfung vorhandener
Annotationen unabhängig davon, ob sie von Menschen oder Maschinen stammen.
Die derzeit verfügbaren Eingaben sind ausschließlich maschinell erzeugt;
das ist eine Eigenschaft der Daten, keine Einschränkung der Anwendung.
Zunächst genügt eine ärztliche Prüfung pro Fall.
Das Datenmodell muss weitere unabhängige Prüfende zulassen; eine Oberfläche
zum Zusammenführen ihrer Ergebnisse gehört nicht zum ersten Stand.

Der primäre Einstieg ist das Markieren von Text. Annotationen ohne Belegstelle
sind ausdrücklich möglich, insbesondere bei importierten Vorschlägen.
Die Oberfläche zeigt Kontextangaben an der ausgewählten Annotation und hält
den klinischen Text beim Bearbeiten sichtbar.

## 2. Technische Richtung und Alternativen

Empfohlen wird eine neue Anwendung mit Prüfung der Wiederverwendbarkeit von
Span-Bearbeitung und HPO-Suche aus dem benachbarten `hpo-span-annotator`. Dessen bisheriges
Speicherformat wird nicht zum verbindlichen Austauschformat erklärt.
Wiederverwendung ist vor Übernahme anhand der unten genannten Fälle zu prüfen;
Quellrevision, MIT-Lizenz und Attribution werden dokumentiert.

Alternativen sind ein Umbau der bestehenden Anwendung oder eine vollständige
Neuentwicklung. Der Umbau berührt ebenfalls Datenmodell, Speichern und Export;
eine vollständige Neuentwicklung würde bewährte Span- und Suchfunktionen
ersetzen. Selektive Wiederverwendung ist deshalb der bevorzugte Ausgangspunkt,
ohne bereits einen Kostenvorteil zu behaupten.

Vorgeschlagener lokaler Repositoryname: `hpo-annotation-editor`, als Nachbar
dieses Benchmark-Repositories. Beschlossen ist ein Python-Backend mit einer
TypeScript-Browseroberfläche. Vorgeschlagen werden FastAPI und Pydantic für
API und verbindliche Laufzeitvalidierung, SQLite für den Arbeitsbereich sowie
React mit Vite für die Oberfläche. Aus OpenAPI generierte TypeScript-Typen
vermeiden manuell duplizierte Schnittstellenmodelle; sie ersetzen keine
serverseitige Validierung.

Die vorhandenen Python-Ontologie-/Suchmodule werden gezielt übernommen und
geprüft, vorhandenes Browser-JavaScript wird über einen schmalen Adapter angebunden.
Das neue Datenmodell braucht eigene Validierung; bestehende Benchmark-Regeln
werden nur übernommen, soweit ihre Semantik tatsächlich passt.
Sprachübergreifende Formatkompatibilität wird über versionierte Verträge und
gemeinsame Testdaten abgesichert, einschließlich Hashes und Unicode-Offsets.
Die gebaute Oberfläche wird vom Python-Dienst ausgeliefert. Node.js wird für
Entwicklung und Build benötigt, nicht für den Betrieb des gebauten Pakets.
Ein Startbefehl startet den Dienst ausschließlich auf Loopback.
Schreibzugriffe verlangen eine sitzungsgebundene Berechtigung und eine gültige
Origin; die lokale Schnittstelle wird nicht beliebigen Webseiten geöffnet.

Die Anwendung funktioniert nach Installation und Bereitstellung der gepinnten
HPO-Datei ohne externe Dienste. Sie benötigt weder Cloudkonto noch LLM-Aufrufe.

## 3. Arbeitsabläufe

### Arbeitspaket öffnen

Ein Paket enthält unveränderliche Dokumenttexte, Dokumentidentitäten und
Prüfsummen, die Ontologieidentität sowie optional Vorschlagsmengen beliebiger Herkunft.
Die HPO-Datei wird lokal bereitgestellt und gegen Release und Prüfsumme geprüft.
Schema- oder Prüfsummenfehler verhindern den Import ohne Teilübernahme.

Die Person wählt eine lokale Annotierendenidentität und einen Arbeitsmodus.
Diese Identität dient der Zuordnung, nicht als Nachweis einer authentifizierten
Person. Unabhängige Annotation und Vorschlagsreview verwenden getrennte
Arbeitsbereiche. Bereits gesehene Vorschläge lassen sich durch einen Moduswechsel
nicht wieder methodisch ungesehen machen; eine neue unabhängige Sitzung ist
deshalb kein Beleg für verblindete Annotation.

### Unabhängig annotieren

Der Browser erhält in diesem Modus keine Vorschläge oder daraus abgeleiteten
Hinweise. Textauswahl startet eine Annotation, HPO-Suche ergänzt den Term.
Weitere Belegstellen können derselben Annotation hinzugefügt werden.
Eine ausdrückliche Aktion erzeugt eine Annotation ohne Belegstelle.

### Vorhandene Annotationen prüfen

Menschliche und maschinelle Eingaben verwenden dasselbe Annotationsmodell,
dieselben Import-, Bearbeitungs-, Validierungs-, Review- und Exportregeln.
Die Herkunft ist Provenienz, kein eigener Modus und keine automatische
Qualitätsbewertung oder Freigabe. Eine menschliche Annotation ist nicht allein
aufgrund ihrer Herkunft akzeptiert. Änderbarkeit folgt Entwurf/Abgabe und
Versionierung, nicht der Art des Urhebers.

Die Vorschlagsliste zeigt Term, Herkunft, vorhandene Belegstellen und vorhandene
Einschätzungen samt deren Herkunft. Fehlende Angaben werden nicht erfunden.
Die Aktionen lauten bestätigen, verwerfen, ändern und unsicher.
Ändern erzeugt eine verknüpfte menschliche Gegenfassung; das Original bleibt
unverändert. Zusätzliche menschliche Annotationen sind möglich.

Reviewer-Unsicherheit ist eine Reviewentscheidung und keine klinische
Assertion. Jede Entscheidung bindet genau die geprüfte Vorschlagsversion und,
bei Änderungen, die Version der menschlichen Gegenfassung. Eine nachträgliche
Änderung der Gegenfassung erfordert erneute Prüfung.

Eine Reviewrunde speichert die ausdrücklich ausgewählte Menge von
Annotationsversionen. Historische Versionen und Gegenfassungen im selben Paket
werden nicht automatisch zu weiteren Pflichtaufgaben. Eine andere Zielmenge
beginnt eine neue Runde; die Auswahlregeln sind für alle Herkunftsarten gleich.

### Speichern und abschließen

Änderungen werden automatisch gespeichert. Die Oberfläche unterscheidet
ungespeichert, gespeichert und Speicherfehler. Ein fehlgeschlagener Schreibvorgang
darf nicht als gespeichert erscheinen; lokale Änderungen bleiben für einen
erneuten Versuch im geöffneten Editor erhalten.

Bearbeitungen, Reviewentscheidungen und Abschluss durchlaufen eine gemeinsame
Schreibwarteschlange. Eine bereits gespeicherte Mutation wird bei verloren
gegangener Antwort anhand ihrer stabilen Vorgangs-ID erkannt und nicht erneut
ausgeführt. Dies ist vom Konflikt mit einem anderen Browserfenster getrennt.

Ein Fall kann ausdrücklich mit null Befunden abgeschlossen werden.
Im Vorschlagsreview müssen alle Vorschläge eine Entscheidung haben;
„unsicher“ zählt als bearbeitet, bleibt aber offen für die spätere Goldauswahl.
Der Abschluss bestätigt zusätzlich, dass der gesamte Text auf weitere Befunde
geprüft wurde. Er erzeugt einen unveränderlichen lokalen Abgabestand.
Erneutes Bearbeiten erzeugt einen neuen Entwurf, ohne die Abgabe zu überschreiben.
Ein abgeschlossener Review ist noch kein freigegebener Goldstandard.

## 4. Datenmodell und Versionierung

- Eine Annotation besitzt eine stabile ID, genau einen HPO-Term, Kontextangaben
  und null oder mehr Evidenz-Erwähnungen.
- Eine Evidenz-Erwähnung besitzt eine stabile ID und ein oder mehrere Segmente.
  Wiederholte Erwähnungen sind getrennte Objekte; unterbrochene Erwähnungen
  bestehen aus mehreren Segmenten eines Objekts.
- Mehrere Annotationen dürfen dieselbe Evidenz nutzen. Die normale Bearbeitung
  einer gemeinsam genutzten Evidenz erzeugt eine eigene Kopie für die gewählte
  Annotation. Andere Annotationen werden nicht stillschweigend verändert.
- Stabile Identitäten bleiben bei Bearbeitung erhalten; unveränderliche
  Inhaltsversionen erhalten eigene Hashes. Der Hash einer Annotationsversion
  bindet auch ihre Evidenzversionen und die Kontextdefinition.
- Referenzen auf Evidenz binden ID und Version. Mehrere Inhaltsversionen
  derselben stabilen ID dürfen gleichzeitig gespeichert und exportiert werden;
  widersprüchlicher Inhalt unter derselben ID-und-Version-Kombination ist ungültig.
- Entscheidungen, Abgaben und Arbeitsbereiche sind pro annotierender Person
  getrennt. Eine zweite Person überschreibt keine erste Entscheidung.
- Dokumentstatus, Reviewentscheidung und klinischer Aussagestatus sind getrennt.

Offsets sind nullbasierte Unicode-Codepoint-Intervalle mit exklusivem Ende im
unveränderlichen importierten Text. Die Browsergrenze wandelt UTF-16-Indizes
explizit um. Nach dem Import wird Text nicht normalisiert oder korrigiert.
Servervalidierung prüft Grenzen, Segmentstruktur und Textbindung. Überlappende
und verschachtelte Erwähnungen bleiben zulässig.

Kontextfelder stammen aus einer eingebauten versionierten Definition, die UI
und Server gemeinsam verwenden. Vorläufig dient die bestehende v1-Semantik
als explizite Editor-Arbeitsdefinition: Assertion present/absent/uncertain,
Experiencer patient/other und Temporality current/historical/future.
Jedes Feld kann im Entwurf ausdrücklich unbekannt sein; keine klinischen
Standardwerte werden automatisch gesetzt. Dies beschließt weder die endgültigen
Benchmark-Achsen noch eine Umdeutung vorhandener v1-Daten. Unbekannte Werte
bleiben auch in lokalen Abgaben sichtbar und sind kein kanonisch gültiger
v1-Export.

SQLite speichert Entwürfe und unveränderliche Abgaben transaktional. Schreibzugriffe
verwenden eine erwartete Revisionsnummer; eine veraltete Browseransicht erhält
einen Konflikt statt fremde Änderungen zu überschreiben. Arbeitsbereichschema,
Austauschformat und Kontextdefinition werden getrennt versioniert.

## 5. Grenze zur Benchmark-Pipeline

Das bestehende `CuratedAnnotationSet/v1` kann gruppierte Erwähnungen, stabile
Identitäten und unbekannte Kontextwerte nicht vollständig darstellen.
Der Editor darf diese Informationen nicht stillschweigend abflachen.

Der erste durchgängige Stand verwendet deshalb ein ausdrücklich editorinternes,
versioniertes Arbeitspaketformat und exportierbare lokale Abgabestände.
Ein Rundlauf zwischen Editor-Installationen muss alle enthaltenen Informationen
erhalten. Das Paket ist noch kein kanonisches Benchmark-Goldformat.

Exportierte Abgaben behalten ihre historischen Ursprungsidentitäten und Hashes.
Beim Import werden sie dem lokalen Paket separat zugeordnet; das Ursprungspaket
muss nicht installiert sein. Frühere Abgaben bleiben schreibgeschützt lesbar und
können als Grundlage eines neuen Entwurfs dienen. Ein Export aus unabhängiger
Annotation enthält keine verborgenen Vorschläge; er transportiert die eigenen
Abgaben und alle zu ihrer Interpretation nötigen Abhängigkeiten.

Die Spezifikation des JSON-Manifests, der JSONL-Daten und ihrer Prüfsummen gehört
zum Implementierungsplan und wird im neuen Repository versioniert.
Importe sind atomar; Archive dürfen weder fremde Pfade überschreiben noch
unbegrenzt entpackt werden. Unbekannte Formatversionen werden abgewiesen.

Die Aufbereitung bestehender E3C-Artefakte in solche Pakete ist eine separate
Aufgabe der Benchmark-Pipeline. Ein synthetisches Paket genügt für die technische
Abnahme des Editors; ein echtes E3C-Paket ist Voraussetzung für den ärztlichen
Pilotbetrieb. Excel-Konvertierung und Schema-Migration erfolgen nicht im Editor.

Kanonische Benchmark-Abgaben bleiben gesperrt, bis ein akzeptierter Vertrag alle
genutzten Strukturen abbildet und dessen Validator integriert ist. Dieser
Entwurf allein autorisiert keine Änderung des Benchmark-Schemas.

## 6. Suche und Oberfläche

Die Oberfläche bietet eine Fallliste, den klinischen Text und einen Bereich für
die ausgewählte Annotation beziehungsweise den ausgewählten Vorschlag.
Kontextfelder erscheinen dort statt gleichzeitig auf allen Vorschlagskarten.
Kennzeichnungen dürfen nicht allein von Farben abhängen; Reviewaktionen sind
per Tastatur erreichbar. Speichern und offene Entscheidungen bleiben sichtbar.

Die Suche unterstützt HPO-ID, Namen, Synonyme, lexikalische Suche und Hierarchie
gegen die gepinnte Ontologie. Semantische Suche gehört nicht zum ersten Stand.
Query, Suchweg, Kandidaten, tatsächlicher Rang, angezeigte Position und Auswahl
werden mit der Ontologie- und Indexidentität protokolliert.
Bewertete lexikalische Treffer behalten die reproduzierbare Durchmischung des
vorhandenen Editors. Exakte Treffer, IDs und Hierarchien werden nicht gemischt.
Transitive Eltern-/Kindbeziehungen lösen einen Hinweis aus, keine automatische
Entfernung oder Ersetzung. Obsolete Terme können angezeigt, aber nicht als neue
gültige Annotation übernommen werden; importierte Probleme bleiben sichtbar.

## 7. Abnahme des ersten Standes

1. Ein synthetisches Paket mit menschlichen und maschinellen Vorschlägen wird importiert, geprüft,
   geschlossen, wieder geöffnet und ohne Informationsverlust exportiert.
2. Bestätigen, Verwerfen, Ändern, Unsicher und Ergänzen erhalten jeweils die
   unveränderte Quelle und eine getrennte menschliche Entscheidung. Identische
   Annotationen mit unterschiedlicher Herkunft erhalten dieselben verfügbaren
   Aktionen, Validierungsregeln und Statusübergänge.
3. Eine spanlose Annotation erhält Evidenz, ohne ihre stabile ID zu verlieren.
4. Wiederholte und unterbrochene Erwähnungen bleiben im Rundlauf unterscheidbar;
   Überlappung und Verschachtelung funktionieren.
5. Gemeinsam genutzte Evidenz kann für eine Annotation geändert werden, ohne
   die andere zu verändern oder deren Entscheidung umzuhängen.
6. Nicht-BMP-Zeichen, kombinierende Zeichen und Zeilenumbrüche erzeugen korrekte
   Auswahl-, Speicher- und Wiederanzeigegrenzen.
7. Unabhängige Annotation liefert keine Vorschläge an den Browser aus.
8. Null-Befund-Abschluss und Abschluss mit unsicheren Entscheidungen sind
   unterscheidbar; beide sind von einer Goldfreigabe getrennt.
9. Veraltete Schreibrevisionen, fehlerhafte Pakete und falsche Ontologien werden
   ohne Datenverlust zurückgewiesen. Speicherfehler sind sichtbar.
10. Eine zweite Annotierendenidentität erzeugt eigene Datensätze, ohne bestehende
    Entscheidungen zu überschreiben. Abgaben bleiben beim Weiterarbeiten erhalten.
11. Zwei Abgaben vor und nach einer Evidenzkorrektur können gemeinsam in einer
    frischen Installation importiert und mit ihren ursprünglichen Hashes gelesen
    werden. Die historische Reviewzielmenge bleibt dabei erhalten.
12. Schnelle Bearbeitung mit unmittelbar folgender Reviewentscheidung erzeugt
    keinen selbst verursachten Konflikt. Nach verloren gegangener Antwort bewirkt
    ein Retry genau eine Mutation und erhält nachfolgende lokale Änderungen.

## 8. Bewusst spätere Arbeit

Mehrpersonen-Abgleich, zentrale Bereitstellung, Benutzerverwaltung, automatische
Cloud-Synchronisation, direkte Modellaufrufe, allgemeine Profilbearbeitung,
Goldauswahlregeln und kanonischer Benchmark-Export folgen getrennt.

Vor Umsetzung wird dieser Entwurf geprüft; anschließend entsteht ein konkreter
Implementierungsplan mit Repositoryanlage, Vertragsdefinition, Wiederverwendungs-
prüfung, Backend, Oberfläche und gezielten Abnahmetests.

## Grundlagen

- [Editor-Handoff](../../hpo-annotation-editor-findings.md)
- [Backendbewertung vom 13. September](../../hpo-annotation-editor-backend-assessment.md)
- [Lokaler Snapshot der Editor-Diskussion](../../hpo-annotation-editor-issue-draft.md)
- Produktentscheidungen aus dem Gespräch vom 1. Oktober 2026.

Die verlinkten lokalen Dokumente sind der gelesene Ausgangsstand; externe
Diskussionen wurden für diesen Entwurf nicht erneut abgeglichen.
