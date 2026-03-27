# Brainstorm: Haus-Stromplanung pflegen & visualisieren

## 1) Zielbild
- Zentrale App, die deine bestehende Planung (inkl. Änderungen nach Hager CAD) als **lebendes Modell** verwaltet.
- Fokus auf drei Kernaufgaben:
  1. **Anlegen** (Struktur, Stromkreise, Verbraucher, Räume)
  2. **Pflegen** (Änderungen versionieren, Historie, Abgleich Soll/Ist)
  3. **Visualisieren** (interaktive/animierte Verbindungen, Lastflüsse)

## 2) Mögliche Kernfunktionen (MVP)
- **Projektstruktur**: Gebäude → Etage → Raum → Verteilung → Stromkreis → Verbraucher.
- **Komponentenbibliothek**: Sicherungen, LS/FI, Leitungen, Steckdosen, Schalter, Aktoren, Geräte.
- **Änderungsjournal**:
  - Jede Änderung mit Datum, Grund, ggf. Foto/Notiz.
  - Diff-Ansicht: „vorher/nachher" für Verdrahtung und Belegung.
- **Verbindungs-Canvas** (Hauptfeature):
  - Knoten = Komponenten, Kanten = Leitungen/Verbindungen.
  - **Animierte Linien** für Stromfluss (Richtung/Intensität farblich codiert).
  - Zoom von Hausansicht bis Klemmenebene.
- **Validierungschecks**:
  - Fehlende Zuordnung (z. B. Verbraucher ohne Stromkreis)
  - Überlastwarnungen pro Kreis
  - Inkonsistenzen zwischen Plan und Realität

## 3) Datenmodell-Ideen
- **Entitäten**: Building, Floor, Room, Panel, Circuit, Device, Connection, Measurement, ChangeEvent.
- **Verbindungen**:
  - Connection besitzt `source`, `target`, `cable_type`, `length`, `phase`, `status`.
- **Versionierung**:
  - Jede Plan-Änderung als Event (Event-Sourcing light) + Snapshot je Version.
- **Import-Strategie**:
  - Da Hager CAD Mobile evtl. keinen direkten offenen Export bietet: manuelles Mapping/CSV/JSON-Import als Übergang.

## 4) Visualisierungsideen (animierte Verbindungen)
- **Modi**:
  - Topologie-Modus (reine Verkabelung)
  - Lastfluss-Modus (animierte „Pulse" entlang der Leitungen)
  - Fehler-Modus (rot blinkende kritische Kanten)
- **Animation**:
  - Liniengeschwindigkeit = Last oder Stromstärke.
  - Farbverlauf = Phase oder Spannungsniveau.
- **Interaktion**:
  - Klick auf Leitung zeigt: Länge, Querschnitt, letzter Check, zugehörige Sicherung.
  - Zeit-Slider: Verlauf von Änderungen oder Lastprofilen über den Tag.

## 5) UX-Konzept
- **Startseite**: „Was hat sich seit dem letzten Stand geändert?"
- **Quick Actions**:
  - „Neuen Stromkreis anlegen"
  - „Leitung umklemmen"
  - „Änderung dokumentieren"
- **Mobile-first Datenerfassung**:
  - Vor Ort schnell Komponenten scannen/fotografieren/notieren.
- **Desktop-first Planung**:
  - Große Canvas-Ansicht für Verdrahtung und Struktur.

## 6) Tech-Optionen
- **Frontend**:
  - React + TypeScript
  - Graph-Visualisierung mit React Flow oder Cytoscape.js
  - Animation via CSS/WebGL (je nach Komplexität)
- **Backend**:
  - Node.js (NestJS/Express) oder Python (FastAPI)
  - PostgreSQL für strukturierte Daten
  - Optional Timeseries (InfluxDB/Timescale), falls Live-Messwerte integriert werden
- **Sync & Offline**:
  - Lokaler Cache (PWA) + späterer Sync

## 7) Erweiterungen (später)
- Live-Daten aus Smart Meter / Shelly / KNX / Modbus.
- Automatische Erkennung „ungewöhnlicher Lastspitzen".
- Wartungsmodus mit Checklisten nach Raum/Verteilung.
- Export als PDF-Dokumentation für Elektriker.

## 8) Konkreter Umsetzungsfahrplan (90 Tage)
1. **Woche 1–2**: Datenmodell + Mockups + Beispielprojekt.
2. **Woche 3–5**: CRUD für Räume, Kreise, Geräte, Verbindungen.
3. **Woche 6–8**: Interaktive Topologie-Visualisierung.
4. **Woche 9–10**: Änderungsjournal + Versionen.
5. **Woche 11–12**: Lastfluss-Animation + Validierungschecks.
6. **Woche 13**: Stabilisieren, Testdaten, erste Nutzung im echten Haus.

## 9) Nächster sinnvoller Schritt
- Ein Mini-Projekt mit **einer Unterverteilung + 5–10 Stromkreisen** als Pilot aufsetzen.
- Ziel: Innerhalb weniger Tage sehen, ob Datenmodell + Visualisierung wirklich zu deiner Arbeitsweise passen.
