import { findByProps } from "@vendetta/metro";
import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { DEFAULT_SETTINGS, ensureDefaults, randomizeNoise } from "./settings-model";
import { subscribe, getPaths } from "./engine";
import { mergeByMajor } from "./contours";
import { bakeGif } from "./bake";

const { ScrollView, View, Pressable, Text, Dimensions } = ReactNative;
const { FormSection, FormRow, FormInput, FormText, FormSwitchRow } = Forms;

let svgModule: { Svg: any; Path: any } | null = null;
function getSvg() {
    if (svgModule) return svgModule;
    try {
        const found = findByProps("SvgXml") as any;
        if (found?.default && found?.Path) svgModule = { Svg: found.default, Path: found.Path };
    } catch {
        // Settings screen degrades to no-preview if svg isn't resolved; the
        // background itself (index.tsx) handles this independently.
    }
    return svgModule;
}

// Sized to actually fill the settings screen width (minus the same padding
// used around it) instead of a small fixed pixel box, and tall enough to
// read as a real preview rather than a sliver. Uses the same shared engine
// as the live background (keyed by this exact size), so there's one
// generation codepath, not a second copy of the timer/lifecycle logic.
const PREVIEW_HEIGHT = 275;

function Preview() {
    const svg = getSvg();
    const { width: screenWidth } = Dimensions.get("window");
    const previewWidth = screenWidth - 32;

    const [, forceTick] = React.useState(0);
    React.useEffect(() => subscribe(previewWidth, PREVIEW_HEIGHT, () => forceTick((t) => t + 1)), [previewWidth]);

    const majorEvery = storage.majorEvery ?? DEFAULT_SETTINGS.majorEvery;
    const colorMain = storage.colorMain ?? DEFAULT_SETTINGS.colorMain;
    const colorSub = storage.colorSub ?? DEFAULT_SETTINGS.colorSub;
    const colorBg = storage.colorBg ?? DEFAULT_SETTINGS.colorBg;
    const glow = storage.glow ?? DEFAULT_SETTINGS.glow;

    if (!svg) {
        return (
            <View style={{ width: "100%", height: PREVIEW_HEIGHT, backgroundColor: colorBg, alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
                <FormText>Preview unavailable</FormText>
            </View>
        );
    }

    const { Svg, Path } = svg;
    const paths = getPaths(previewWidth, PREVIEW_HEIGHT);
    const { major, minor } = mergeByMajor(paths, majorEvery);

    return (
        <View style={{ width: "100%", height: PREVIEW_HEIGHT, backgroundColor: colorBg, borderRadius: 8, overflow: "hidden" }}>
            <Svg width={previewWidth} height={PREVIEW_HEIGHT}>
                {minor ? <Path d={minor} stroke={colorSub} strokeWidth={1} strokeOpacity={0.32} fill="none" /> : null}
                {major && glow ? <Path d={major} stroke={colorMain} strokeWidth={4} strokeOpacity={0.25} fill="none" /> : null}
                {major ? <Path d={major} stroke={colorMain} strokeWidth={1.6} fill="none" /> : null}
            </Svg>
        </View>
    );
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
    const presets = ["#7869be", "#5865F2", "#57F287", "#FEE75C", "#ED4245", "#EB459E", "#FFFFFF", "#0a0a0c"];
    return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 16, paddingBottom: 12 }}>
            {presets.map((c) => (
                <Pressable
                    key={c}
                    onPress={() => onChange(c)}
                    style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
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
                    onPress={() => onChange(clamp(Math.round((value - step) * 1000) / 1000))}
                    style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}
                >
                    <Text style={{ color: "white", fontSize: 18 }}>-</Text>
                </Pressable>
                <Pressable
                    onPress={() => onChange(clamp(Math.round((value + step) * 1000) / 1000))}
                    style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}
                >
                    <Text style={{ color: "white", fontSize: 18 }}>+</Text>
                </Pressable>
            </View>
        </View>
    );
}

function BakeSection() {
    useProxy(storage);
    const [baking, setBaking] = React.useState(false);
    const [progress, setProgress] = React.useState("");
    const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

    const cachedGifPath = storage.cachedGifPath as string | undefined;
    const useCachedGif = !!storage.useCachedGif;

    return (
        <FormSection title="Baked Background (experimental)">
            <FormText style={{ paddingHorizontal: 16, paddingBottom: 16, color: "#F0B232" }}>
                ⚠️ Your device will likely stutter for several seconds while this bakes. Also keep in mind: changes you make without pressing Apply will only show in this preview, not in chat, once you've baked before.
            </FormText>

            <FormRow
                label={baking ? progress || "Baking..." : "Apply (bake to GIF)"}
                subLabel={!baking ? `Renders at ${Math.round(screenWidth)}x${Math.round(screenHeight)}` : undefined}
                onPress={async () => {
                    if (baking) return;
                    setBaking(true);
                    try {
                        const path = await bakeGif(screenWidth, screenHeight, (msg) => setProgress(msg));
                        storage.cachedGifPath = path;
                        storage.useCachedGif = true;
                        showToast("Baked successfully");
                    } catch (e) {
                        showToast("Bake failed: " + (e && (e as Error).message ? (e as Error).message : String(e)));
                    } finally {
                        setBaking(false);
                        setProgress("");
                    }
                }}
            />

            {cachedGifPath ? (
                <FormSwitchRow
                    label="Use baked GIF"
                    subLabel={useCachedGif ? "Showing the baked GIF" : "Baked GIF exists but live rendering is active"}
                    value={useCachedGif}
                    onValueChange={(v: boolean) => (storage.useCachedGif = v)}
                />
            ) : null}
        </FormSection>
    );
}

export default function Settings() {
    useProxy(storage);
    ensureDefaults();

    const [importText, setImportText] = React.useState("");

    const gridStep = storage.gridStep ?? DEFAULT_SETTINGS.gridStep;
    const levels = storage.levels ?? DEFAULT_SETTINGS.levels;
    const levelRange = storage.levelRange ?? DEFAULT_SETTINGS.levelRange;
    const speed = storage.speed ?? DEFAULT_SETTINGS.speed;
    const majorEvery = storage.majorEvery ?? DEFAULT_SETTINGS.majorEvery;
    const colorMain = storage.colorMain ?? DEFAULT_SETTINGS.colorMain;
    const colorSub = storage.colorSub ?? DEFAULT_SETTINGS.colorSub;
    const colorBg = storage.colorBg ?? DEFAULT_SETTINGS.colorBg;
    const glow = storage.glow ?? DEFAULT_SETTINGS.glow;
    const bgOpacity = storage.bgOpacity ?? DEFAULT_SETTINGS.bgOpacity;

    return (
        <ScrollView>
            <View style={{ padding: 16 }}>
                <Preview />
            </View>

            <BakeSection />

            <FormSection title="Geometry">
                <Stepper label="Grid step (detail)" value={gridStep} min={10} max={24} step={1} format={(v) => String(v)} onChange={(v) => (storage.gridStep = v)} />
                <Stepper label="Contour levels" value={levels} min={4} max={12} step={1} format={(v) => String(v)} onChange={(v) => (storage.levels = v)} />
                <Stepper label="Level range (spread)" value={levelRange} min={0.5} max={6} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => (storage.levelRange = v)} />
                <Stepper label="Major line every" value={majorEvery} min={1} max={10} step={1} format={(v) => String(v)} onChange={(v) => (storage.majorEvery = v)} />
            </FormSection>

            <FormSection title="Animation">
                <Stepper label="Animation speed" value={speed} min={0} max={5} step={0.1} format={(v) => v.toFixed(1) + "x"} onChange={(v) => (storage.speed = v)} />
                <Stepper label="Background opacity" value={bgOpacity} min={0.1} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => (storage.bgOpacity = v)} />
            </FormSection>

            <FormSection title="Color">
                <FormRow label="Major line color" />
                <ColorSwatches value={colorMain} onChange={(c) => (storage.colorMain = c)} />
                <FormInput title="Custom" value={colorMain} onChange={(v: string) => (storage.colorMain = v)} placeholder="#7869be" style={{ marginHorizontal: 16, marginBottom: 12 }} />

                <FormRow label="Minor line color" />
                <ColorSwatches value={colorSub} onChange={(c) => (storage.colorSub = c)} />
                <FormInput title="Custom" value={colorSub} onChange={(v: string) => (storage.colorSub = v)} placeholder="#5a5a8c" style={{ marginHorizontal: 16, marginBottom: 12 }} />

                <FormRow label="Background color" />
                <ColorSwatches value={colorBg} onChange={(c) => (storage.colorBg = c)} />
                <FormInput title="Custom" value={colorBg} onChange={(v: string) => (storage.colorBg = v)} placeholder="#0a0a0c" style={{ marginHorizontal: 16, marginBottom: 12 }} />

                <FormSwitchRow label="Glow on major lines" value={glow} onValueChange={(v: boolean) => (storage.glow = v)} />
            </FormSection>

            <FormSection title="Presets">
                <FormRow
                    label="Randomize"
                    subLabel="Shuffles the noise terms for a different (but still non-panning) pattern"
                    onPress={() => {
                        storage.noise = randomizeNoise();
                        showToast("Randomized");
                    }}
                />
                <FormRow
                    label="Reset to defaults"
                    onPress={() => {
                        Object.assign(storage, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
                        showToast("Reset to defaults");
                    }}
                />
            </FormSection>

            <FormSection title="Import / Export">
                <FormRow
                    label="Copy config to clipboard"
                    onPress={() => {
                        clipboard.setString(JSON.stringify(storage, null, 2));
                        showToast("Copied to clipboard");
                    }}
                />
                <FormInput
                    title="Paste config JSON here"
                    value={importText}
                    onChange={(v: string) => setImportText(v)}
                    placeholder="{ ... }"
                    style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 4 }}
                    multiline
                />
                <FormRow
                    label="Import"
                    onPress={() => {
                        try {
                            const parsed = JSON.parse(importText);
                            Object.assign(storage, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), parsed);
                            if (parsed.noise) storage.noise = { ...DEFAULT_SETTINGS.noise, ...parsed.noise };
                            showToast("Imported");
                        } catch (e) {
                            showToast("Invalid JSON: " + (e && (e as Error).message ? (e as Error).message : String(e)));
                        }
                    }}
                />
            </FormSection>
        </ScrollView>
    );
}
