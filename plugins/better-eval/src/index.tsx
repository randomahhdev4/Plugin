import { registerCommand } from "@vendetta/commands";
import { ReactNative } from "@vendetta/metro/common";
import { showCustomAlert } from "@vendetta/ui/alerts";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";

import Settings from "./Settings";
import { ensureDefaults } from "./settings-model";

const { ScrollView, Text } = ReactNative;

function ResultDialog({ result }: { result: string }) {
    return (
        <ScrollView style={{ maxHeight: 480 }}>
            <Text selectable style={{ color: "#DBDEE1", fontFamily: "monospace", fontSize: 12, padding: 16 }}>
                {result}
            </Text>
        </ScrollView>
    );
}

function stringifyResult(value: any): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        try {
            return String(value);
        } catch {
            return "[unstringifiable value]";
        }
    }
}

async function runEval(code: string): Promise<string> {
    try {
        // eslint-disable-next-line no-eval
        let result = (0, eval)(code);
        if (result && typeof result.then === "function") {
            result = await result;
        }
        return stringifyResult(result);
    } catch (e: any) {
        const message = e && e.message ? e.message : String(e);
        const stack = e && e.stack ? String(e.stack) : "";
        return `ERROR: ${message}\n\n${stack}`;
    }
}

let unregisterCommand: (() => void) | undefined;

export default {
    onLoad: () => {
        ensureDefaults();

        // options: [] deliberately - the code to run lives in plugin
        // settings instead of a command argument. That's the one pattern
        // already proven to enable cleanly in this environment; a non-empty
        // options array is the one thing untested so far.
        unregisterCommand = registerCommand({
            name: "deval",
            displayName: "deval",
            description: "Evaluate the code saved in Better Eval's settings and show the result in a dismissible dialog.",
            displayDescription: "Evaluate the code saved in Better Eval's settings and show the result in a dismissible dialog.",
            options: [],
            applicationId: "-1",
            inputType: 0,
            type: 1,
            execute: async () => {
                const code = storage.code || "";
                const result = code.trim()
                    ? await runEval(code)
                    : "No code set. Open Better Eval's settings and paste some in first.";
                showCustomAlert(ResultDialog, { result });
                // No content returned: nothing gets sent as an actual chat
                // message. This is a local, dismissible dialog only you see,
                // and it has no length cap the way a sent message would.
            },
        } as any);

        logger.log("[BetterEval] Loaded.");
    },
    onUnload: () => {
        unregisterCommand?.();
        unregisterCommand = undefined;
    },
    settings: Settings,
};
