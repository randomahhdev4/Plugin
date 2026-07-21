import { React, ReactNative } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { DEFAULT_SETTINGS, ensureDefaults } from "./settings-model";

const { ScrollView, View, Pressable, Text } = ReactNative;
const { FormSection, FormRow, FormInput, FormText } = Forms;

const PRESET_COLORS = [
    "#8C7DFF",
    "#5865F2",
    "#57F287",
    "#FEE75C",
    "#ED4245",
    "#EB459E",
    "#FFFFFF",
];

const SPEED_PRESETS = [
    { label: "Slow", value: 0.0002 },
    { label: "Normal", value: 0.0006 },
    { label: "Fast", value: 0.0012 },
    { label: "Very fast", value: 0.002 },
];

function Pill({ selected, onPress, children }: { selected: boolean; onPress: () => void; children: React.ReactNode }) {
    return (
        <Pressable
            onPress={onPress}
            style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 16,
                backgroundColor: selected ? "#5865F2" : "rgba(255,255,255,0.08)",
            }}
        >
            <Text style={{ color: "white", fontWeight: selected ? "700" : "400" }}>{children}</Text>
        </Pressable>
    );
}

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
                        borderWidth: value.toLowerCase() === c.toLowerCase() ? 2 : 1,
                        borderColor: value.toLowerCase() === c.toLowerCase() ? "white" : "rgba(255,255,255,0.3)",
                    }}
                />
            ))}
        </View>
    );
}

function Stepper({
    label,
    value,
    min,
    max,
    step,
    format,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
    onChange: (v: number) => void;
}) {
    const clamp = (v: number) => Math.min(max, Math.max(min, v));
    return (
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
            <FormText style={{ marginBottom: 8 }}>{`${label}: ${format(value)}`}</FormText>
            <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                    onPress={() => onChange(clamp(value - step))}
                    style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}
                >
                    <Text style={{ color: "white", fontSize: 18 }}>-</Text>
                </Pressable>
                <Pressable
                    onPress={() => onChange(clamp(value + step))}
                    style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}
                >
                    <Text style={{ color: "white", fontSize: 18 }}>+</Text>
                </Pressable>
            </View>
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
            <FormSection title="Color">
                <FormRow label="Line color" subLabel="Tap a preset or type a custom hex/rgba value" />
                <ColorSwatches value={lineColor} onChange={(c) => (storage.lineColor = c)} />
                <FormInput
                    title="Custom color"
                    value={lineColor}
                    onChange={(v: string) => (storage.lineColor = v)}
                    placeholder="#8C7DFF"
                    style={{ marginHorizontal: 16, marginBottom: 12 }}
                />
            </FormSection>

            <FormSection title="Appearance">
                <Stepper
                    label="Line opacity"
                    value={lineOpacity}
                    min={0.1}
                    max={1}
                    step={0.05}
                    format={(v) => v.toFixed(2)}
                    onChange={(v) => (storage.lineOpacity = v)}
                />
                <Stepper
                    label="Contour density"
                    value={contourDensity}
                    min={4}
                    max={16}
                    step={1}
                    format={(v) => String(Math.round(v))}
                    onChange={(v) => (storage.contourDensity = Math.round(v))}
                />
                <FormRow label="Drift speed" />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingBottom: 16 }}>
                    {SPEED_PRESETS.map((p) => (
                        <Pill key={p.label} selected={Math.abs(driftSpeed - p.value) < 1e-9} onPress={() => (storage.driftSpeed = p.value)}>
                            {p.label}
                        </Pill>
                    ))}
                </View>
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
