import { ReactNative } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";

import { ensureDefaults } from "./settings-model";

const { ScrollView } = ReactNative;
const { FormSection, FormSwitchRow, FormText, FormRow } = Forms;

export default function Settings() {
    useProxy(storage);
    ensureDefaults();

    return (
        <ScrollView>
            <FormSection title="Better Typing Indicator">
                <FormSwitchRow
                    label="Hide typing indicator"
                    subLabel="Completely hides the typing indicator instead of enhancing it"
                    value={storage.hideTypingIndicator}
                    onValueChange={(v: boolean) => (storage.hideTypingIndicator = v)}
                />
                <FormText style={{ padding: 16 }}>
                    Shows up to 3 stacked avatars of who's typing, in order. With more than 3 people
                    typing it switches to "Several people are typing..." and shows as many avatars as
                    reasonably fit.
                </FormText>
                <FormRow label="Run /typing-status in any channel" subLabel="Posts a full diagnostic report" />
            </FormSection>
        </ScrollView>
    );
}
