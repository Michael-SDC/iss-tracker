import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata = {
  title: "ISS-Live-Tracker",
  description: "Aktuelle Position der Internationalen Raumstation live auf der Karte",
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
