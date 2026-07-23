import { storage } from "@vendetta/plugin";
import { DEFAULT_SETTINGS } from "./settings-model";
import { buildAllContourPaths } from "./contours";

// How often the expensive part (marching squares over the whole grid) runs.
// The reference HTML recomputes every requestAnimationFrame (~60fps) because
// a desktop browser's hardware-accelerated canvas can afford that; SVG path
// string rebuilding + React reconciling on a phone cannot. Throttling to
// ~6fps keeps the same "slowly evolving terrain" look (a background doesn't
// need 60fps smoothness) while cutting the expensive work by ~90%.
const REGEN_INTERVAL_MS = 160;

// Keyed by "widthxheight" (main background uses the full window; the
// settings preview uses its own smaller size) and kept at MODULE scope, not
// component-instance scope. <TopographicBackground/> gets recreated as a
// brand new element every time MessagesConnected re-renders (which happens
// often - new messages, etc.); if the timer/time/paths lived in that
// component's own refs, a remount would silently reset all of it, and
// visible updates would end up depending on how often MessagesConnected
// happens to re-render for unrelated reasons instead of our own interval.
// Storing state here means it survives remounts entirely - only truly
// stops when literally nothing is subscribed to that size.
type EngineState = {
    time: number;
    paths: string[];
    intervalId: ReturnType<typeof setInterval> | null;
    startTimeout: ReturnType<typeof setTimeout> | null;
    listeners: Set<() => void>;
};

const engines = new Map<string, EngineState>();

function keyFor(width: number, height: number): string {
    return `${Math.round(width)}x${Math.round(height)}`;
}

function getEngine(key: string): EngineState {
    let e = engines.get(key);
    if (!e) {
        e = { time: 0, paths: [], intervalId: null, startTimeout: null, listeners: new Set() };
        engines.set(key, e);
    }
    return e;
}

function tick(e: EngineState, width: number, height: number) {
    const gridStep = storage.gridStep ?? DEFAULT_SETTINGS.gridStep;
    const levels = storage.levels ?? DEFAULT_SETTINGS.levels;
    const levelRange = storage.levelRange ?? DEFAULT_SETTINGS.levelRange;
    const speed = storage.speed ?? DEFAULT_SETTINGS.speed;
    const noise = storage.noise ?? DEFAULT_SETTINGS.noise;

    const dtPerTick = 0.012 * speed * (REGEN_INTERVAL_MS / 16.67);
    e.time += dtPerTick;
    e.paths = buildAllContourPaths(width, height, gridStep, levels, levelRange, e.time, noise);
    e.listeners.forEach((fn) => fn());
}

/** Subscribes a component to updates for a given size; returns an unsubscribe function. */
export function subscribe(width: number, height: number, onUpdate: () => void): () => void {
    const key = keyFor(width, height);
    const e = getEngine(key);
    e.listeners.add(onUpdate);

    if (!e.intervalId && !e.startTimeout) {
        // Deferred slightly so the very first (synchronous, most expensive)
        // computation doesn't block whatever transition is happening right
        // as this mounts (e.g. opening a channel).
        e.startTimeout = setTimeout(() => {
            e.startTimeout = null;
            tick(e, width, height);
            e.intervalId = setInterval(() => tick(e, width, height), REGEN_INTERVAL_MS);
        }, 50);
    }

    return () => {
        e.listeners.delete(onUpdate);
        if (e.listeners.size === 0) {
            if (e.intervalId) {
                clearInterval(e.intervalId);
                e.intervalId = null;
            }
            if (e.startTimeout) {
                clearTimeout(e.startTimeout);
                e.startTimeout = null;
            }
        }
    };
}

export function getPaths(width: number, height: number): string[] {
    return getEngine(keyFor(width, height)).paths;
}
