"use client";

import { useEffect, useRef, useState } from "react";

const API_URL = "https://api.wheretheiss.at/v1/satellites/25544";
const POLL_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 4000;

const numberFormat = (digits) =>
  new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const coordFormat = numberFormat(4);
const wholeFormat = numberFormat(0);

export default function Home() {
  const mapElement = useRef(null);
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map;
    let marker;
    let timer;
    let firstFix = true;
    let leaflet;

    async function update() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(API_URL, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const { latitude, longitude, altitude, velocity } = data;
        if (![latitude, longitude, altitude, velocity].every(Number.isFinite)) {
          throw new Error("Unerwartete Antwort");
        }
        if (cancelled) return;

        const latlng = [latitude, longitude];
        marker.setLatLng(latlng);
        if (firstFix) {
          map.setView(latlng, 3);
          firstFix = false;
        }
        setPosition({ latitude, longitude, altitude, velocity });
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        clearTimeout(timeout);
        if (!cancelled) timer = setTimeout(update, POLL_INTERVAL_MS);
      }
    }

    async function init() {
      // Leaflet greift auf `window` zu und darf nur im Browser geladen werden.
      leaflet = (await import("leaflet")).default;
      if (cancelled) return;

      map = leaflet.map(mapElement.current, { worldCopyJump: true }).setView([0, 0], 2);
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
        })
        .addTo(map);

      const icon = leaflet.divIcon({
        className: "iss-marker",
        html: "🛰️",
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      marker = leaflet.marker([0, 0], { icon, title: "ISS" }).addTo(map);

      update();
    }

    init();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (map) map.remove();
    };
  }, []);

  return (
    <main className="app">
      <header className="header">
        <h1>ISS-Live-Tracker</h1>
        <p>Aktuelle Position der Internationalen Raumstation</p>
      </header>

      {error && (
        <div className="notice" role="alert">
          Die ISS-Daten sind gerade nicht erreichbar. Wir versuchen es weiter und
          aktualisieren automatisch, sobald die Verbindung wieder steht.
          {position && " Angezeigt wird die zuletzt bekannte Position."}
        </div>
      )}

      <section className="stats" aria-live="polite">
        <Stat label="Breite" value={position && `${coordFormat.format(position.latitude)}°`} />
        <Stat label="Länge" value={position && `${coordFormat.format(position.longitude)}°`} />
        <Stat label="Höhe" value={position && `${wholeFormat.format(position.altitude)} km`} />
        <Stat label="Geschwindigkeit" value={position && `${wholeFormat.format(position.velocity)} km/h`} />
      </section>

      <div ref={mapElement} className="map" aria-label="Karte mit der aktuellen ISS-Position" />
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value ?? "…"}</span>
    </div>
  );
}
