import { ReactNative } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

const { ScrollView } = ReactNative;
const { FormSection, FormRow, FormText } = Forms;

export default function Settings() {
    return (
        <ScrollView>
            <FormSection title="Status">
                <FormText style={{ padding: 16 }}>
                    This is a diagnostic-only build. If you can see this settings screen, the plugin
                    loaded and enabled successfully. Background rendering will be added back once
                    install/enable is confirmed working.
                </FormText>
                <FormRow
                    label="Show status toast"
                    subLabel="Confirms onLoad ran without opening a channel"
                    onPress={() => showToast("✅ Topographic Chat Background is loaded and enabled.")}
                />
                <FormRow label="Run /topo-status in any channel" subLabel="Posts the same confirmation as a command" />
            </FormSection>
        </ScrollView>
    );
}
