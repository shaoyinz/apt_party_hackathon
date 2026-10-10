export async function postLocation(path, body) {
    try {
        const response = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok)
            return { status: "provider_failure", message: "The location service failed. Retry to try again." };
        return await response.json();
    }
    catch {
        return { status: "provider_failure", message: "The location service failed. Retry to try again." };
    }
}
