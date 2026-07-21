import { React, ReactNative } from "@vendetta/metro/common";
import { storage, useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { DEFAULT_SETTINGS, ensureDefaults } from "./settings-model";

const { ScrollView, View, Pressable } = ReactNative;
const { FormSection, FormRow, FormSlider, FormInput, FormDivider, FormText } = Forms;

const PRESET_COLORS = [
    "rgba(255, 255, 255, 0.15)",
    "rgba(88, 101, 242, 0.35)",
    "rgba(87, 242, 135, 0.3)",
    "rgba(254, 231, 92, 0.3)",
    "rgba(237, 66, 69, 0.3)",
    "rgba(235, 69, 158, 0.3)",
];

function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
    return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 16, paddingBottom: 12 }}>
            {PRESET_COLORS.map((c) => (
                <Pressable
                    key={c}
                    onPress={() => onChange(c)}
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        backgroundColor: c,
                        borderWidth: value === c ? 2 : 1,
                        borderColor: value === c ? "white" : "rgba(255,255,255,0.3)",
                    }}
                />
            ))}
        </View>
    );
}

export default function Settings() {
    useProxy(storage);
    ensureDefaults();

    const driftSpeed = storage.driftSpeed ?? DEFAULT_SETTINGS.driftSpeed;
    const contourDensity = storage.contourDensity ?? DEFAULT_SETTINGS.contourDensity;
    const lineOpacity = storage.lineOpacity ?? DEFAULT_SETTINGS.lineOpacity;
    const lineColor = storage.lineColor ?? DEFAULT_SETTINGS.lineColor;

    return (
        <ScrollView>
            <FormSection title="Appearance">
                <FormRow label="Line color" subLabel="Tap a preset or enter a custom rgba/hex value below" />
                <ColorSwatches value={lineColor} onChange={(c) => (storage.lineColor = c)} />
                <FormInput
                    title="Custom color"
                    value={lineColor}
                    onChange={(v: string) => (storage.lineColor = v)}
                    placeholder="rgba(255, 255, 255, 0.15)"
                    style={{ marginHorizontal: 16, marginBottom: 12 }}
                />

                <FormDivider />
                <FormRow label={`Line opacity: ${Number(lineOpacity).toFixed(2)}`} />
                <FormSlider
                    minimumValue={0.05}
                    maximumValue={0.8}
                    step={0.01}
                    value={lineOpacity}
                    onValueChange={(v: number) => (storage.lineOpacity = v)}
                />

                <FormDivider />
                <FormRow label={`Contour density: ${contourDensity}`} />
                <FormSlider
                    minimumValue={4}
                    maximumValue={20}
                    step={1}
                    value={contourDensity}
                    onValueChange={(v: number) => (storage.contourDensity = Math.round(v))}
                />

                <FormDivider />
                <FormRow label={`Drift speed: ${Number(driftSpeed).toFixed(5)}`} />
                <FormSlider
                    minimumValue={0.0001}
                    maximumValue={0.002}
                    step={0.0001}
                    value={driftSpeed}
                    onValueChange={(v: number) => (storage.driftSpeed = v)}
                />
            </FormSection>

            <FormSection title="Status">
                <FormText style={{ padding: 16 }}>
                    Changes apply the next time a message list re-renders (e.g. switching channels).
                </FormText>
                <FormRow
                    label="Show status toast"
                    subLabel="Confirms the plugin is loaded and enabled"
                    onPress={() => showToast("✅ Topographic Chat Background is loaded and enabled.")}
                />
                <FormRow label="Run /topo-status in any channel" subLabel="Posts a full diagnostic report" />
            </FormSection>
        </ScrollView>
    );
}
