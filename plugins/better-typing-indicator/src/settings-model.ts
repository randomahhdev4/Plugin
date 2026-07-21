import { storage } from "@vendetta/plugin";

export type SettingsState = {
    hideTypingIndicator: boolean;
};

export const DEFAULT_SETTINGS: SettingsState = {
    hideTypingIndicator: false,
};

export function ensureDefaults() {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (storage[key] === undefined) storage[key] = (DEFAULT_SETTINGS as any)[key];
    }
}
