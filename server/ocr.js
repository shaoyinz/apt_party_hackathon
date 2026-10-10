import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/ocr_screenshot.py");

export async function ocrStatus() {
    try {
        const result = await execFileAsync("python3", [scriptPath, "--check"], { timeout: 15000 });
        const payload = JSON.parse(result.stdout);
        return { available: payload.ok === true, engine: payload.engine || "python" };
    }
    catch {
        return { available: false, engine: "python" };
    }
}

export async function readImageText(filePath) {
    try {
        const result = await execFileAsync("python3", [scriptPath, filePath], {
            timeout: 60000,
            maxBuffer: 4_000_000,
        });
        const payload = JSON.parse(lastJson(result.stdout));
        if (!payload.ok)
            return { ok: false, code: payload.code || "ocr_failed", message: payload.message || "Screenshot text could not be read." };
        return { ok: true, text: payload.text || "" };
    }
    catch {
        return { ok: false, code: "ocr_failed", message: "Roost could not read text from one or more screenshots. You can still enter the facts yourself." };
    }
}

function lastJson(stdout) {
    const lines = String(stdout || "").trim().split("\n").filter(Boolean);
    return lines[lines.length - 1] || "{}";
}
