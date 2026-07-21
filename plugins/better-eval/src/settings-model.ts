import { storage } from "@vendetta/plugin";

export function ensureDefaults() {
    if (storage.code === undefined) storage.code = "";
}
