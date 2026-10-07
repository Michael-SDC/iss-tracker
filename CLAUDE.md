# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Befehle

- `npm run dev` – Dev-Server (http://localhost:3000)
- `npm run build` / `npm start` – Produktions-Build und -Start
- Es gibt weder Lint noch Tests. Geprüft wird manuell im Browser.
- Deployment: Vercel (`npx vercel --prod`), HTTPS kommt automatisch.

## Rahmenbedingungen (aus `ai_docs/PRD.md`)

Reine Frontend-App: Next.js App Router, Quellcode ausschließlich in `app/`, **kein eigenes Backend** (einzige Ausnahme wäre ein Proxy unter `app/api/` für den Bonus „Astronauten-Liste"). Keine API-Keys im Code.

- Datenquelle ist `https://api.wheretheiss.at/v1/satellites/25544` (HTTPS). Open Notify nicht verwenden: nur HTTP, der Browser blockiert es als Mixed Content.
- Alle Requests müssen HTTPS sein. Die Konsole darf keinen Mixed-Content-Fehler zeigen.
- UI-Texte, Kommentare und Zahlenformat sind Deutsch (`de-DE`, km und km/h). Kacheln: OpenStreetMap mit Attribution.
- Ein API-Fehler darf nie zu einer leeren Seite führen. Das Polling läuft weiter und erholt sich selbst.

## Architektur

Einzelne Seite, drei Dateien:

- `app/page.js` – Client-Komponente (`"use client"`) mit Karte, Polling, Statuswerten, Dark-Mode-Schalter und „Zur ISS"-Button.
- `app/ocean-waves.js` – animiertes WebGL-Wellen-Overlay als Leaflet-Layer (`createOceanWaves(leaflet, tiles)`).
- `app/globals.css` – Styles und Theme-Variablen.

Wichtige Zusammenhänge, die man nur über mehrere Dateien erkennt:

- **Leaflet nur im Browser:** Es wird in `init()` per dynamischem `import("leaflet")` geladen, weil es `window` braucht. Nicht oben in die Datei importieren (kein SSR der Karte). Nur das CSS wird in `layout.js` importiert.
- **Polling:** Ein selbst terminierter `setTimeout`-Loop in `page.js` (5 s Intervall, 4 s Abbruch per `AbortController`). Der nächste Timer wird im `finally` gesetzt, damit er auch nach Fehlern weiterläuft. Die Antwort wird auf endliche Zahlen validiert.
- **Karte und Marker liegen in Refs** (`mapRef`, `markerRef`), nicht im State. Der Setup-Effekt läuft einmal, Updates gehen direkt an Leaflet, React rendert nur die Statuswerte neu.
- **Wellen-Overlay:** Ein WebGL-Canvas zwischen Kachel- und Marker-Ebene. Die Wasser/Land-Maske wird aus den geladenen OSM-Kacheln anhand der Wasserfarbe `#aad3df` abgeleitet. Deshalb braucht der Tile-Layer `crossOrigin: true`, und die Maske darf nicht auf eingefärbte Kacheln schauen. Ab Zoom 12 wird das Overlay ausgeblendet (float32-Präzision im Shader). Die Wellengröße ist bewusst zoomunabhängig (`WAVE_SCALE` pro Bildschirmpixel).
- **Dark Mode:** `document.documentElement.dataset.theme` steuert CSS-Variablen. Die Kacheln werden per CSS-`filter` auf `.leaflet-tile-pane` invertiert, nicht über andere Kacheln. Die Wellen bekommen den Modus zusätzlich über `waves.setDark()`. Die Wahl liegt in `localStorage` (`iss-tracker-theme`) und wird erst nach dem Mounten gelesen, damit es keinen Hydration-Mismatch gibt (Start ist immer hell).
- **„Zur ISS":** schwenkt per `panTo` auf die echte Marker-Position und lässt den Zoom unverändert. Leaflet zeichnet den Marker nur auf der Original-Weltkarte, nicht auf den Weltkopien. `worldCopyJump` springt danach zurück.

## Skills

Unter `.claude/skills/` liegt `vercel-react-best-practices` (installiert aus `vercel-labs/agent-skills`, Stand in `skills-lock.json`).
