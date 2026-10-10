import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export async function ocrStatus() {
    const binary = process.env.TESSERACT_BIN || "tesseract";
    try {
        await execFileAsync(binary, ["--version"], { timeout: 3000 });
        return { available: true, binary };
    }
    catch {
        try {
            await access("/usr/bin/tesseract");
            return { available: true, binary: "/usr/bin/tesseract" };
        }
        catch {
            return { available: false, binary };
        }
    }
}

export async function readImageText(filePath) {
    const status = await ocrStatus();
    if (!status.available) {
        return { ok: false, code: "ocr_unavailable", message: "Screenshot text extraction is unavailable on this machine. Enter the facts yourself or retry later." };
    }
    try {
        const result = await execFileAsync(status.binary, [filePath, "stdout", "-l", "eng"], {
            timeout: 20000,
            maxBuffer: 2_000_000,
        });
        return { ok: true, text: result.stdout || "" };
    }
    catch {
        return { ok: false, code: "ocr_failed", message: "Roost could not read text from one or more screenshots. You can still enter the facts yourself." };
    }
}
