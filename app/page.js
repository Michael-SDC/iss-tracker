"use client";

import { useEffect, useRef, useState } from "react";
import { createOceanWaves } from "./ocean-waves";

const THEME_KEY = "iss-tracker-theme";
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
  const [theme, setTheme] = useState("light");
  const wavesRef = useRef(null);
  const darkRef = useRef(false);

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
      // crossOrigin: nötig, damit die Kacheln für die Wassermaske des Wellen-Overlays gelesen werden dürfen.
      const tiles = leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          crossOrigin: true,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
        })
        .addTo(map);
      const waves = createOceanWaves(leaflet, tiles);
      waves.setDark(darkRef.current);
      waves.addTo(map);
      wavesRef.current = waves;

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

  // Gespeicherte Wahl erst nach dem Mounten lesen (Start ist immer hell, kein Hydration-Mismatch).
  useEffect(() => {
    try {
      if (localStorage.getItem(THEME_KEY) === "dark") setTheme("dark");
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    darkRef.current = theme === "dark";
    if (wavesRef.current) wavesRef.current.setDark(darkRef.current);
  }, [theme]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>ISS-Live-Tracker</h1>
          <p>Aktuelle Position der Internationalen Raumstation</p>
        </div>
        <ThemeToggle dark={theme === "dark"} onToggle={toggleTheme} />
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

function ThemeToggle({ dark, onToggle }) {
  return (
    <div className="theme-toggle">
      <span className={`theme-icon ${dark ? "" : "active"}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label="Dunkler Modus"
        className="switch"
        onClick={onToggle}
      >
        <span className="switch-thumb" />
      </button>
      <span className={`theme-icon ${dark ? "active" : ""}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </span>
    </div>
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
