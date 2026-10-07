// Animiertes Wellen-Overlay für Leaflet.
//
// Ein einzelner WebGL-Canvas liegt zwischen Kachel- und Marker-Ebene. Aus den
// geladenen OSM-Kacheln wird eine Wasser/Land-Maske abgeleitet (Pixel in der
// OSM-Wasserfarbe = Wasser); der Fragment-Shader zeichnet Wellen nur dort.
// Die Wellen sind in Weltkoordinaten berechnet und bleiben beim Verschieben
// der Karte an ihr verankert.

const WATER_RGB = [170, 211, 223]; // OSM-Wasserfarbe #aad3df
const MASK_RESOLUTION = 0.5; // Maske in halber Auflösung, per LINEAR geglättet
const MASK_PADDING = 0.5; // Maske reicht je Seite um 50 % über den Viewport hinaus
const MASK_DEBOUNCE_MS = 120;
const MAX_DPR = 2;
// Oberhalb dieser Zoomstufe reicht die float32-Genauigkeit der Weltkoordinaten im Shader
// nicht mehr aus (Wellen würden zu Blöcken). Dort wird das Overlay ausgeblendet.
const MAX_WAVE_ZOOM = 12;
// Wellen-Einheiten pro Bildschirmpixel, unabhängig vom Zoom; größer = kleinere Wellen.
const WAVE_SCALE = 0.04;

const VERTEX_SHADER = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 uRes;        // Canvasgröße in CSS-Pixeln
uniform float uDpr;
uniform vec2 uOriginS;    // Weltpixel-Ursprung des Viewports, bereits skaliert
uniform float uScale;     // Weltpixel -> Wellenkoordinaten
uniform float uTime;
uniform vec2 uMaskOffset; // Viewport-Pixel -> Maskenpixel (CSS-Pixel)
uniform vec2 uMaskSize;   // Maskengröße in CSS-Pixeln
uniform sampler2D uMask;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

// Summiert eine Sinuswelle: r.x = Höhe, r.yz = Gradient.
void addWave(vec2 p, float t, vec2 d, float k, float a, float w, inout vec3 r) {
  float ph = dot(d, p) * k + t * w;
  r.x += a * sin(ph);
  r.yz += a * k * cos(ph) * d;
}

float chop(vec2 p, float t) {
  return 0.12 * fbm(p * 2.0 + t * vec2(0.08, 0.04));
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  float mask = texture2D(uMask, (px + uMaskOffset) / uMaskSize).r;
  if (mask < 0.05) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 p = uOriginS + px * uScale;
  float t = uTime;

  // leichte Verzerrung, damit die Wellenfronten nicht zu regelmäßig wirken
  p += 0.15 * vec2(noise(p * 0.7 + t * 0.05), noise(p * 0.7 + 9.0 + t * 0.05));

  vec3 r = vec3(0.0);
  addWave(p, t, normalize(vec2( 0.90,  0.43)),  2.0, 0.50, 0.55, r);
  addWave(p, t, normalize(vec2( 0.55, -0.83)),  3.1, 0.35, 0.70, r);
  addWave(p, t, normalize(vec2(-0.30,  0.95)),  5.3, 0.20, 0.95, r);
  addWave(p, t, normalize(vec2( 0.75,  0.66)),  8.7, 0.12, 1.30, r);
  addWave(p, t, normalize(vec2(-0.85, -0.52)), 13.0, 0.07, 1.70, r);

  // Kleinteilige Kräuselung über numerische Ableitung des Rauschens
  float e = 0.02;
  float h0 = chop(p, t);
  vec2 gn = vec2(chop(p + vec2(e, 0.0), t) - h0, chop(p + vec2(0.0, e), t) - h0) / e;

  vec2 g = r.yz + gn;
  float height = r.x + h0;
  vec3 n = normalize(vec3(-g * 0.45, 1.0));

  vec3 lightDir = normalize(vec3(-0.50, -0.45, 0.75));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 halfDir = normalize(lightDir + viewDir);

  float diffuse = clamp(dot(n, lightDir) * 0.5 + 0.5, 0.0, 1.0);
  float fresnel = pow(1.0 - n.z, 3.0);

  // tiefes, dunkles Blau
  vec3 deep = vec3(0.00, 0.08, 0.24);
  vec3 shallow = vec3(0.04, 0.26, 0.47);
  vec3 sky = vec3(0.80, 0.93, 1.0);

  vec3 color = mix(deep, shallow, clamp(0.40 + height * 0.40 + diffuse * 0.35, 0.0, 1.0));
  color *= 0.80 + 0.40 * diffuse;
  color += fresnel * sky * 0.22;

  // Glitzern: Glanzlicht auf stark gekräuselten Mikro-Normalen plus funkelnde Lichtpunkte
  vec3 nm = normalize(vec3(-(g + gn * 3.0) * 0.55, 1.0));
  float glint = pow(max(dot(nm, halfDir), 0.0), 60.0);
  float tw1 = noise(p * 9.0 + vec2(t * 0.55, -t * 0.40));
  float tw2 = noise(p * 14.0 + vec2(-t * 0.70, t * 0.50) + 31.0);
  float sparkle = smoothstep(0.80, 0.97, tw1 * tw2 * 1.6) * smoothstep(0.25, 0.75, diffuse);
  color += glint * vec3(1.0, 0.98, 0.92) * 1.1;
  color += sparkle * vec3(1.0) * 0.9;

  // dezente Schaumkronen
  float crest = smoothstep(0.65, 1.10, height);
  float foam = crest * smoothstep(0.45, 0.80, fbm(p * 6.0 + t * 0.1));
  color = mix(color, vec3(0.96, 0.99, 1.0), foam * 0.30);

  float alpha = smoothstep(0.25, 0.85, mask) * 0.92;
  gl_FragColor = vec4(color * alpha, alpha);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Shader-Fehler");
  }
  return shader;
}

export function createOceanWaves(L, tileLayer) {
  const OceanWaves = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      this._failed = false;
      this._raf = 0;
      this._maskTimer = 0;
      this._maskReady = false;
      this._reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      this._pane = map.getPane("waves") || map.createPane("waves");
      this._pane.style.zIndex = 250; // über den Kacheln (200), unter Overlays/Markern
      this._pane.style.pointerEvents = "none";

      this._canvas = L.DomUtil.create("canvas", "ocean-waves", this._pane);
      this._canvas.style.opacity = "0";

      try {
        this._initGL();
      } catch {
        this._disable();
        return;
      }

      this._maskCanvas = document.createElement("canvas");
      this._maskCtx = this._maskCanvas.getContext("2d", { willReadFrequently: true });

      map.on("resize", this._resize, this);
      map.on("moveend", this._scheduleMask, this);
      map.on("zoomstart", this._hide, this);
      map.on("zoomend", this._scheduleMask, this);
      tileLayer.on("tileload load", this._scheduleMask, this);
      if (this._reducedMotion) map.on("move", this._redraw, this);

      this._resize();
      this._scheduleMask();
      this._start();
    },

    onRemove(map) {
      map.off("resize", this._resize, this);
      map.off("moveend", this._scheduleMask, this);
      map.off("zoomstart", this._hide, this);
      map.off("zoomend", this._scheduleMask, this);
      tileLayer.off("tileload load", this._scheduleMask, this);
      map.off("move", this._redraw, this);
      cancelAnimationFrame(this._raf);
      clearTimeout(this._maskTimer);
      if (this._gl) {
        const lose = this._gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }
      L.DomUtil.remove(this._canvas);
      this._gl = null;
    },

    _initGL() {
      const gl = this._canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true });
      if (!gl) throw new Error("WebGL nicht verfügbar");
      this._gl = gl;

      const program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "Link-Fehler");
      }
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(program, "aPos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      this._u = {};
      for (const name of ["uRes", "uDpr", "uOriginS", "uScale", "uTime", "uMaskOffset", "uMaskSize", "uMask"]) {
        this._u[name] = gl.getUniformLocation(program, name);
      }

      this._texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(this._u.uMask, 0);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      this._canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        this._disable();
      });
    },

    _disable() {
      this._failed = true;
      cancelAnimationFrame(this._raf);
      if (this._canvas) this._canvas.style.display = "none";
    },

    _resize() {
      const size = this._map.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      this._size = size;
      this._dpr = dpr;
      this._canvas.width = Math.round(size.x * dpr);
      this._canvas.height = Math.round(size.y * dpr);
      this._canvas.style.width = `${size.x}px`;
      this._canvas.style.height = `${size.y}px`;
      this._gl.viewport(0, 0, this._canvas.width, this._canvas.height);
      this._scheduleMask();
    },

    _hide() {
      this._zooming = true;
      this._canvas.style.opacity = "0";
    },

    _scheduleMask() {
      if (this._failed) return;
      clearTimeout(this._maskTimer);
      this._maskTimer = setTimeout(() => this._buildMask(), MASK_DEBOUNCE_MS);
    },

    _viewOrigin() {
      const map = this._map;
      return map.project(map.getCenter(), map.getZoom()).subtract(map.getSize().divideBy(2));
    },

    // Leitet aus den geladenen Kachelbildern eine Wassermaske ab (Rotkanal = Wasseranteil).
    _buildMask() {
      if (this._failed || !this._gl) return;
      const map = this._map;
      const size = map.getSize();
      const padX = size.x * MASK_PADDING;
      const padY = size.y * MASK_PADDING;
      const cssW = size.x + 2 * padX;
      const cssH = size.y + 2 * padY;
      const w = Math.ceil(cssW * MASK_RESOLUTION);
      const h = Math.ceil(cssH * MASK_RESOLUTION);

      const canvas = this._maskCanvas;
      const ctx = this._maskCtx;
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      const zoom = map.getZoom();
      const mapRect = map.getContainer().getBoundingClientRect();
      for (const tile of Object.values(tileLayer._tiles)) {
        const el = tile.el;
        if (!el || tile.coords.z !== zoom || !el.complete || !el.naturalWidth) continue;
        const r = el.getBoundingClientRect();
        ctx.drawImage(
          el,
          (r.left - mapRect.left + padX) * MASK_RESOLUTION,
          (r.top - mapRect.top + padY) * MASK_RESOLUTION,
          r.width * MASK_RESOLUTION,
          r.height * MASK_RESOLUTION
        );
      }

      let image;
      try {
        image = ctx.getImageData(0, 0, w, h);
      } catch {
        // Kacheln ohne CORS-Freigabe machen den Canvas "tainted": Overlay abschalten.
        this._disable();
        return;
      }

      const data = image.data;
      const [wr, wg, wb] = WATER_RGB;
      for (let i = 0; i < data.length; i += 4) {
        const dist = Math.abs(data[i] - wr) + Math.abs(data[i + 1] - wg) + Math.abs(data[i + 2] - wb);
        // 1 bei exakter Wasserfarbe, weich auslaufend bis Toleranz 45
        const t = Math.min(Math.max((dist - 12) / 33, 0), 1);
        const water = 1 - t * t * (3 - 2 * t);
        data[i] = water * 255;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }

      const gl = this._gl;
      gl.bindTexture(gl.TEXTURE_2D, this._texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

      this._maskOrigin = this._viewOrigin();
      this._maskCss = { w: cssW, h: cssH, padX, padY };
      this._maskReady = true;
      this._zooming = false;
      this._canvas.style.opacity = "1";
      if (this._reducedMotion) this._draw(0);
    },

    _start() {
      if (this._reducedMotion) return;
      const t0 = performance.now();
      const loop = (now) => {
        this._raf = requestAnimationFrame(loop);
        this._draw((now - t0) / 1000);
      };
      this._raf = requestAnimationFrame(loop);
    },

    _redraw() {
      this._draw(0);
    },

    _draw(time) {
      const gl = this._gl;
      if (!gl || !this._maskReady || this._failed) return;
      const map = this._map;

      // Canvas am Viewport festhalten, obwohl sich das Karten-Pane beim Schwenken verschiebt
      L.DomUtil.setPosition(this._canvas, map.containerPointToLayerPoint([0, 0]));

      const zoom = map.getZoom();
      // Während der Zoom-Animation (und bis die neue Maske steht) bleibt das Overlay ausgeblendet.
      if (this._zooming) return;
      if (zoom > MAX_WAVE_ZOOM) {
        this._canvas.style.opacity = "0";
        return;
      }
      this._canvas.style.opacity = "1";
      // Fester Faktor pro Bildschirmpixel: die Wellen sind auf jeder Zoomstufe gleich groß.
      // Der Ursprung bleibt in Weltpixeln der aktuellen Zoomstufe, die Wellen haften also an der Karte.
      const scale = WAVE_SCALE;
      const origin = this._viewOrigin();
      const m = this._maskCss;

      gl.uniform2f(this._u.uRes, this._size.x, this._size.y);
      gl.uniform1f(this._u.uDpr, this._dpr);
      gl.uniform2f(this._u.uOriginS, origin.x * scale, origin.y * scale);
      gl.uniform1f(this._u.uScale, scale);
      gl.uniform1f(this._u.uTime, time);
      gl.uniform2f(
        this._u.uMaskOffset,
        origin.x - this._maskOrigin.x + m.padX,
        origin.y - this._maskOrigin.y + m.padY
      );
      gl.uniform2f(this._u.uMaskSize, m.w, m.h);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  });

  return new OceanWaves();
}
