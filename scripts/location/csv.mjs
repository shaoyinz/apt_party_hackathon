export function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (quoted) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index += 1;
                }
                else {
                    quoted = false;
                }
            }
            else {
                field += char;
            }
            continue;
        }
        if (char === '"') {
            quoted = true;
        }
        else if (char === ",") {
            row.push(field);
            field = "";
        }
        else if (char === "\n" || char === "\r") {
            if (char === "\r" && text[index + 1] === "\n")
                index += 1;
            row.push(field);
            field = "";
            if (row.some((value) => value !== ""))
                rows.push(row);
            row = [];
        }
        else {
            field += char;
        }
    }
    if (field.length || row.length) {
        row.push(field);
        if (row.some((value) => value !== ""))
            rows.push(row);
    }
    const [header, ...body] = rows;
    if (!header)
        return [];
    return body.map((columns) => Object.fromEntries(header.map((name, index) => [name, columns[index] ?? ""])));
}
