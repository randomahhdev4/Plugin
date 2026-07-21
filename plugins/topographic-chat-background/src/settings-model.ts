import { storage } from "@vendetta/plugin";

export type SettingsState = {
    driftSpeed: number;
    contourDensity: number;
    lineOpacity: number;
    lineColor: string;
};

export const DEFAULT_SETTINGS: SettingsState = {
    driftSpeed: 0.00035,
    contourDensity: 10,
    lineOpacity: 0.16,
    lineColor: "rgba(255, 255, 255, 0.15)",
};

export function ensureDefaults() {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (storage[key] === undefined) storage[key] = (DEFAULT_SETTINGS as any)[key];
    }
}
