import { storage } from "@vendetta/plugin";

export type SettingsState = {
    driftSpeed: number;
    contourDensity: number;
    lineOpacity: number;
    lineColor: string;
};

export const DEFAULT_SETTINGS: SettingsState = {
    driftSpeed: 0.0006,
    contourDensity: 10,
    // Opaque color - the visible `lineOpacity` setting is the only place
    // transparency should come from. Stacking alpha in both the color AND
    // a separate opacity prop compounds multiplicatively (0.15 * 0.16 =
    // ~2.4% effective opacity), which is functionally invisible.
    lineColor: "#8C7DFF",
    lineOpacity: 0.45,
};

export function ensureDefaults() {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (storage[key] === undefined) storage[key] = (DEFAULT_SETTINGS as any)[key];
    }
}
