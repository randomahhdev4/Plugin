import * as React from "react";

type SettingsState = {
  driftSpeed: number;
  contourDensity: number;
  lineOpacity: number;
  lineColor: string;
};

const DEFAULT_SETTINGS: SettingsState = {
  driftSpeed: 0.00035,
  contourDensity: 10,
  lineOpacity: 0.16,
  lineColor: "rgba(255, 255, 255, 0.15)"
};

const GLOBAL_KEY = "__topographicChatBackgroundPlugin";

type PluginInstance = {
  onLoad: () => void;
  onUnload: () => void;
  applySettings: (next: Partial<SettingsState>) => void;
};

class TopographicChatBackground implements PluginInstance {
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private rafId: number | null = null;
  private resizeHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private settings: SettingsState = { ...DEFAULT_SETTINGS };
  private offsetX = 0;
  private offsetY = 0;
  private lastTimestamp = 0;
  private isLoaded = false;

  public onLoad = () => {
    if (this.isLoaded) {
      return;
    }

    this.settings = this.readStoredSettings();
    this.container = this.findTargetContainer();
    this.createCanvas();
    this.attachListeners();
    this.resizeCanvas();
    this.lastTimestamp = performance.now();
    this.startLoop();
    this.isLoaded = true;
  };

  public onUnload = () => {
    if (!this.isLoaded) {
      return;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }

    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }

    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.isLoaded = false;
  };

  public applySettings = (next: Partial<SettingsState>) => {
    this.settings = { ...this.settings, ...next };
    this.writeStoredSettings(this.settings);
    this.resizeCanvas();
    if (this.canvas && this.ctx) {
      this.renderFrame();
    }
  };

  private readStoredSettings(): SettingsState {
    if (typeof window === "undefined" || !window.localStorage) {
      return { ...DEFAULT_SETTINGS };
    }

    try {
      const raw = window.localStorage.getItem("topographic-chat-background-settings");
      if (!raw) {
        return { ...DEFAULT_SETTINGS };
      }
      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private writeStoredSettings(settings: SettingsState) {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.setItem("topographic-chat-background-settings", JSON.stringify(settings));
    } catch {
      // Ignore storage write failures.
    }
  }

  private findTargetContainer(): HTMLElement {
    const selectors = [
      ".chat-content",
      "[class*='chatContent']",
      "[class*='chat-content']",
      "[class*='messagesWrapper']",
      "[class*='messageList']",
      "[class*='channelTextArea']",
      "main"
    ];

    for (const selector of selectors) {
      const match = document.querySelector<HTMLElement>(selector);
      if (match) {
        return match;
      }
    }

    return document.body;
  }

  private createCanvas() {
    if (!this.container) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.style.position = this.container === document.body ? "fixed" : "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.zIndex = "-1";
    canvas.style.pointerEvents = "none";
    canvas.style.display = "block";
    canvas.style.background = "transparent";
    canvas.style.opacity = "1";
    canvas.style.border = "0";

    this.container.style.position = this.container.style.position || "relative";
    this.container.style.overflow = this.container.style.overflow || "hidden";
    this.container.appendChild(canvas);

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  private attachListeners() {
    this.resizeHandler = () => this.resizeCanvas();
    this.visibilityHandler = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      this.resizeCanvas();
    };

    window.addEventListener("resize", this.resizeHandler);
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private resizeCanvas() {
    if (!this.canvas || !this.container) {
      return;
    }

    const rect = this.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
    }
  }

  private startLoop() {
    const tick = (timestamp: number) => {
      if (!this.isLoaded || !this.canvas || !this.ctx || !this.container) {
        this.rafId = null;
        return;
      }

      if (document.visibilityState === "hidden") {
        this.rafId = window.requestAnimationFrame(tick);
        return;
      }

      const elapsed = Math.max(0.001, (timestamp - this.lastTimestamp) / 1000);
      this.lastTimestamp = timestamp;
      this.offsetX += this.settings.driftSpeed * elapsed * 60;
      this.offsetY += this.settings.driftSpeed * elapsed * 36;
      this.renderFrame();
      this.rafId = window.requestAnimationFrame(tick);
    };

    this.rafId = window.requestAnimationFrame(tick);
  }

  private renderFrame() {
    if (!this.canvas || !this.ctx || !this.container) {
      return;
    }

    const rect = this.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const width = rect.width;
    const height = rect.height;
    const density = Math.max(4, Math.round(this.settings.contourDensity));
    const levels = Array.from({ length: density }, (_, index) => (index + 1) / (density + 1));

    this.ctx.clearRect(0, 0, width, height);
    this.ctx.save();
    this.ctx.globalAlpha = this.settings.lineOpacity;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.strokeStyle = this.resolveLineColor();
    this.ctx.lineWidth = 1.1;

    const sampleScale = 0.023 + Math.min(0.02, density * 0.0012);
    const cols = Math.max(24, Math.round(width / 18));
    const rows = Math.max(18, Math.round(height / 18));
    const field = this.generateField(cols + 1, rows + 1, sampleScale, this.offsetX, this.offsetY);

    for (const level of levels) {
      this.renderContourLevel(field, cols + 1, rows + 1, width, height, level);
    }

    this.ctx.restore();
  }

  private renderContourLevel(
    field: number[][],
    cols: number,
    rows: number,
    width: number,
    height: number,
    level: number
  ) {
    if (!this.ctx) {
      return;
    }

    const stepX = width / (cols - 1);
    const stepY = height / (rows - 1);

    for (let y = 0; y < rows - 1; y += 1) {
      for (let x = 0; x < cols - 1; x += 1) {
        const topLeft = field[y][x];
        const topRight = field[y][x + 1];
        const bottomRight = field[y + 1][x + 1];
        const bottomLeft = field[y + 1][x];

        const values = [topLeft, topRight, bottomRight, bottomLeft];
        const state = this.marchState(values, level);
        if (state === 0 || state === 15) {
          continue;
        }

        const points = this.interpolateCellEdges(
          x * stepX,
          y * stepY,
          stepX,
          stepY,
          topLeft,
          topRight,
          bottomRight,
          bottomLeft,
          level
        );

        if (points.length >= 2) {
          this.ctx.beginPath();
          this.ctx.moveTo(points[0][0], points[0][1]);
          for (let i = 1; i < points.length; i += 1) {
            this.ctx.lineTo(points[i][0], points[i][1]);
          }
          this.ctx.stroke();
        }
      }
    }
  }

  private marchState(values: number[], level: number): number {
    let state = 0;
    if (values[0] >= level) {
      state |= 1;
    }
    if (values[1] >= level) {
      state |= 2;
    }
    if (values[2] >= level) {
      state |= 4;
    }
    if (values[3] >= level) {
      state |= 8;
    }
    return state;
  }

  private interpolateCellEdges(
    x: number,
    y: number,
    stepX: number,
    stepY: number,
    topLeft: number,
    topRight: number,
    bottomRight: number,
    bottomLeft: number,
    level: number
  ): Array<[number, number]> {
    const top = this.interpolatePoint(x, y, x + stepX, y, topLeft, topRight, level);
    const right = this.interpolatePoint(x + stepX, y, x + stepX, y + stepY, topRight, bottomRight, level);
    const bottom = this.interpolatePoint(x + stepX, y + stepY, x, y + stepY, bottomRight, bottomLeft, level);
    const left = this.interpolatePoint(x, y + stepY, x, y, bottomLeft, topLeft, level);

    const state = this.marchState([topLeft, topRight, bottomRight, bottomLeft], level);

    const points: Array<[number, number]> = [];

    const edgeMap: Record<number, Array<[number, number]>> = {
      1: [left, top],
      2: [top, right],
      3: [left, right],
      4: [right, bottom],
      5: [left, bottom],
      6: [top, bottom],
      7: [left, top, bottom],
      8: [bottom, left],
      9: [top, bottom],
      10: [top, right],
      11: [right, bottom],
      12: [left, right],
      13: [top, left],
      14: [bottom, right],
      15: []
    };

    return edgeMap[state] ?? [];
  }

  private interpolatePoint(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    value1: number,
    value2: number,
    level: number
  ): [number, number] {
    if (Math.abs(value2 - value1) < 1e-8) {
      return [x1, y1];
    }

    const t = (level - value1) / (value2 - value1);
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    return [x, y];
  }

  private generateField(cols: number, rows: number, scale: number, offsetX: number, offsetY: number): number[][] {
    const field: number[][] = [];
    for (let y = 0; y < rows; y += 1) {
      const row: number[] = [];
      for (let x = 0; x < cols; x += 1) {
        const value = this.perlinNoise(x * scale + offsetX, y * scale + offsetY);
        row.push(value);
      }
      field.push(row);
    }
    return field;
  }

  private resolveLineColor(): string {
    const cssVar = getComputedStyle(document.documentElement)
      .getPropertyValue("--interactive-muted")
      .trim();

    if (this.settings.lineColor && this.settings.lineColor.trim()) {
      return this.settings.lineColor.trim();
    }

    return cssVar || "rgba(255, 255, 255, 0.15)";
  }

  private perlinNoise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const xf = x - x0;
    const yf = y - y0;

    const u = this.fade(xf);
    const v = this.fade(yf);

    const n00 = this.gradientDot(x0, y0, x, y);
    const n01 = this.gradientDot(x0, y0 + 1, x, y);
    const n10 = this.gradientDot(x0 + 1, y0, x, y);
    const n11 = this.gradientDot(x0 + 1, y0 + 1, x, y);

    const x1 = this.lerp(n00, n10, u);
    const x2 = this.lerp(n01, n11, u);
    return this.lerp(x1, x2, v);
  }

  private gradientDot(ix: number, iy: number, x: number, y: number): number {
    const gradientX = this.hash(ix, iy) % 4;
    const gradientY = this.hash(ix + 1, iy + 2) % 4;
    const dx = x - ix;
    const dy = y - iy;
    const angle = (gradientX * 0.5 + gradientY * 0.25) % 4;
    switch (angle) {
      case 0:
        return dx + dy;
      case 1:
        return -dx + dy;
      case 2:
        return -dx - dy;
      default:
        return dx - dy;
    }
  }

  private hash(x: number, y: number): number {
    const seed = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return Math.floor(seed % 2147483647);
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
}

function SettingsPanel(props: {
  settings?: Partial<SettingsState>;
  onChange?: (settings: SettingsState) => void;
}) {
  const [state, setState] = React.useState<SettingsState>({
    ...DEFAULT_SETTINGS,
    ...(props.settings ?? {})
  });

  React.useEffect(() => {
    setState({ ...DEFAULT_SETTINGS, ...(props.settings ?? {}) });
  }, [props.settings]);

  const update = (patch: Partial<SettingsState>) => {
    const next = { ...state, ...patch };
    setState(next);
    props.onChange?.(next);

    const plugin = (globalThis as typeof globalThis & Record<string, unknown>)[GLOBAL_KEY] as
      | { applySettings?: (settings: Partial<SettingsState>) => void }
      | undefined;
    plugin?.applySettings?.(next);
  };

  return (
    <div style={{ display: "grid", gap: "12px", color: "var(--text-normal)", fontFamily: "inherit" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span>Drift Speed: {state.driftSpeed.toFixed(4)}</span>
        <input
          type="range"
          min="0.0001"
          max="0.002"
          step="0.0001"
          value={state.driftSpeed}
          onChange={(event) => update({ driftSpeed: Number(event.target.value) })}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span>Contour Density: {state.contourDensity}</span>
        <input
          type="range"
          min="4"
          max="20"
          step="1"
          value={state.contourDensity}
          onChange={(event) => update({ contourDensity: Number(event.target.value) })}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span>Line Opacity: {state.lineOpacity.toFixed(2)}</span>
        <input
          type="range"
          min="0.05"
          max="0.8"
          step="0.01"
          value={state.lineOpacity}
          onChange={(event) => update({ lineOpacity: Number(event.target.value) })}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span>Line Color</span>
        <input
          type="text"
          value={state.lineColor}
          onChange={(event) => update({ lineColor: event.target.value })}
          style={{ padding: "8px", borderRadius: "6px", border: "1px solid var(--background-modifier-accent)" }}
        />
      </label>
    </div>
  );
}

const pluginInstance = ((globalThis as typeof globalThis & Record<string, unknown>)[GLOBAL_KEY] as PluginInstance | undefined) ?? new TopographicChatBackground();
(globalThis as typeof globalThis & Record<string, unknown>)[GLOBAL_KEY] = pluginInstance;

const onLoad = () => pluginInstance.onLoad();
const onUnload = () => pluginInstance.onUnload();

export default {
  onLoad,
  onUnload,
  settings: SettingsPanel
};
