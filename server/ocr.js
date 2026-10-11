import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(root, "scripts/ocr_screenshot.py");
const venvPython = path.join(root, ".venv/bin/python");

function pythonBin() {
    if (process.env.ROOST_PYTHON)
        return process.env.ROOST_PYTHON;
    if (existsSync(venvPython))
        return venvPython;
    return "python3";
}

export async function ocrStatus() {
    try {
        const result = await execFileAsync(pythonBin(), [scriptPath, "--check"], { timeout: 15000 });
        const payload = JSON.parse(result.stdout);
        return {
            available: payload.ok === true,
            engine: payload.engine || "python",
            reason: payload.ok === true ? null : clip(payload.message || "OCR check failed."),
        };
    }
    catch (error) {
        return { available: false, engine: "python", reason: ocrFailureReason(error) };
    }
}

export async function readImageText(filePath) {
    try {
        const result = await execFileAsync(pythonBin(), [scriptPath, filePath], {
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

function ocrFailureReason(error) {
    const stdout = String(error?.stdout || "");
    let payload = {};
    try {
        payload = JSON.parse(lastJson(stdout));
    }
    catch {
        payload = {};
    }
    if (payload.message)
        return clip(payload.message);
    const stderr = String(error?.stderr || "").trim().split("\n").filter(Boolean).pop();
    return clip(stderr || "OCR check failed.");
}

function clip(text) {
    return String(text || "OCR check failed.").replace(/\s+/g, " ").trim().slice(0, 240);
}
