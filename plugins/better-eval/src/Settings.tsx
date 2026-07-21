import { ReactNative } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";

import { ensureDefaults } from "./settings-model";

const { ScrollView } = ReactNative;
const { FormSection, FormInput, FormText } = Forms;

export default function Settings() {
    useProxy(storage);
    ensureDefaults();

    return (
        <ScrollView>
            <FormSection title="Better Eval">
                <FormText style={{ padding: 16 }}>
                    Paste JavaScript below, then run /deval in any channel. Supports async code and
                    Promises. The result (or a thrown error + stack) shows in a scrollable dialog only
                    you can see, with no length limit and nothing sent to the channel.
                </FormText>
                <FormInput
                    title="Code"
                    value={storage.code || ""}
                    onChange={(v: string) => (storage.code = v)}
                    placeholder="vendetta.plugins.plugins"
                    style={{ marginHorizontal: 16, marginBottom: 12 }}
                    multiline
                />
            </FormSection>
        </ScrollView>
    );
}
