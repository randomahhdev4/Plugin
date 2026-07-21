import { React, ReactNative } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

import { DEFAULT_SETTINGS } from "./settings-model";

const { ScrollView } = ReactNative;
const { FormSection, FormRow, FormSlider, FormInput, FormDivider } = Forms;

export default function Settings() {
    useProxy(storage);

    // Guarantee values exist so sliders/inputs are always controlled.
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (storage[key] === undefined) storage[key] = DEFAULT_SETTINGS[key];
    }

    return (
        <ScrollView>
            <FormSection title="Contours">
                <FormRow label={`Drift speed: ${Number(storage.driftSpeed).toFixed(5)}`} />
                <FormSlider
                    minimumValue={0.0001}
                    maximumValue={0.002}
                    step={0.0001}
                    value={storage.driftSpeed}
                    onValueChange={(v: number) => (storage.driftSpeed = v)}
                />
                <FormDivider />
                <FormRow label={`Contour density: ${storage.contourDensity}`} />
                <FormSlider
                    minimumValue={4}
                    maximumValue={20}
                    step={1}
                    value={storage.contourDensity}
                    onValueChange={(v: number) => (storage.contourDensity = Math.round(v))}
                />
                <FormDivider />
                <FormRow label={`Line opacity: ${Number(storage.lineOpacity).toFixed(2)}`} />
                <FormSlider
                    minimumValue={0.05}
                    maximumValue={0.8}
                    step={0.01}
                    value={storage.lineOpacity}
                    onValueChange={(v: number) => (storage.lineOpacity = v)}
                />
            </FormSection>
            <FormSection title="Color">
                <FormInput
                    title="Line color (CSS rgba/hex)"
                    value={storage.lineColor}
                    onChange={(v: string) => (storage.lineColor = v)}
                    placeholder="rgba(255, 255, 255, 0.15)"
                />
            </FormSection>
        </ScrollView>
    );
}
