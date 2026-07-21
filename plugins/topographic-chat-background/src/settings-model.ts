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
