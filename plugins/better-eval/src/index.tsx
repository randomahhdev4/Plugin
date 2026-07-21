import { registerCommand } from "@vendetta/commands";
import { logger } from "@vendetta";

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
            description: "Evaluate JavaScript and reply with the result. Supports async/Promises.",
            displayDescription: "Evaluate JavaScript and reply with the result. Supports async/Promises.",
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
            execute: async (args: any[]) => {
                const code = extractCode(args);
                if (!code.trim()) return { content: "No code provided." };
                const result = await runEval(code);
                return { content: result.length > 1900 ? result.slice(0, 1900) + "\n…(truncated)" : result };
            },
        } as any);

        logger.log("[BetterEval] Loaded.");
    },
    onUnload: () => {
        unregisterCommand?.();
        unregisterCommand = undefined;
    },
};
