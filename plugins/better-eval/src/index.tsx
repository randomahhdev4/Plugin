import { React, ReactNative } from "@vendetta/metro/common";
import { registerCommand } from "@vendetta/commands";
import { showCustomAlert } from "@vendetta/ui/alerts";
import { logger } from "@vendetta";

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
    if (value && typeof value.then === "function") {
        return "[Promise returned - this tool only shows synchronous results. Avoid fetch/async; use synchronous data already available on-device instead.]";
    }
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

function runEval(code: string): string {
    try {
        // eslint-disable-next-line no-eval
        const result = (0, eval)(code);
        return stringifyResult(result);
    } catch (e: any) {
        const message = e && e.message ? e.message : String(e);
        const stack = e && e.stack ? String(e.stack) : "";
        return `ERROR: ${message}\n\n${stack}`;
    }
}

function extractCode(args: any[]): string {
    if (!Array.isArray(args) || !args.length) return "";
    const named = args.find((a) => a && a.name === "code");
    if (named && typeof named.value === "string") return named.value;
    const first = args[0];
    if (first && typeof first.value === "string") return first.value;
    if (typeof first === "string") return first;
    return "";
}

let unregisterCommand: (() => void) | undefined;

export default {
    onLoad: () => {
        unregisterCommand = registerCommand({
            name: "deval",
            displayName: "deval",
            description: "Evaluate JS and show the full result in a scrollable dialog (no truncation).",
            displayDescription: "Evaluate JS and show the full result in a scrollable dialog (no truncation).",
            options: [
                {
                    name: "code",
                    displayName: "code",
                    description: "JavaScript to evaluate",
                    displayDescription: "JavaScript to evaluate",
                    type: 3, // STRING
                    required: true,
                },
            ],
            applicationId: "-1",
            inputType: 0,
            type: 1,
            execute: (args: any[]) => {
                const code = extractCode(args);
                const result = runEval(code);
                showCustomAlert(ResultDialog, { result });
                return { content: `Ran \`${code.length > 60 ? code.slice(0, 60) + "…" : code}\` — see dialog for full result.` };
            },
        } as any);

        logger.log("[BetterEval] Loaded.");
    },
    onUnload: () => {
        unregisterCommand?.();
        unregisterCommand = undefined;
    },
};
