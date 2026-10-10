const CITIES = ["Sunnyvale", "Santa Clara", "Mountain View", "Cupertino", "San Jose"];
const NEIGHBORHOODS = [
    "Downtown Sunnyvale",
    "Santa Clara University",
    "Castro Street",
    "Cupertino Village",
    "Santana Row",
    "Downtown San Jose",
];

export const AMENITY_RULES = [
    ["In-unit laundry", /\bin[- ]unit laundry\b|\bwasher\/dryer in unit\b|\bw\/d in unit\b/i],
    ["On-site laundry", /\bon[- ]site laundry\b|\blaundry (?:on site|in building|room)\b/i],
    ["Air conditioning", /\bair conditioning\b|\bcentral a\/c\b|\ba\/c\b/i],
    ["Heating", /\bheating\b|\bcentral heat\b/i],
    ["Dishwasher", /\bdishwasher\b/i],
    ["Balcony", /\bbalcony\b|\bpatio\b/i],
    ["Gym", /\bgym\b|\bfitness center\b/i],
    ["Swimming pool", /\bswimming pool\b|\bpool\b/i],
    ["Bike storage", /\bbike storage\b/i],
    ["Dedicated workspace", /\bdedicated workspace\b|\boffice nook\b/i],
    ["Furnished", /\bfurnished\b/i],
    ["Gated parking", /\bgated parking\b/i],
    ["Controlled building access", /\bcontrolled (?:building )?access\b|\bsecure entry\b/i],
    ["Security cameras", /\bsecurity cameras\b/i],
    ["On-site security", /\bon[- ]site security\b/i],
    ["Covered parking", /\bcovered parking\b/i],
    ["EV charging", /\bev charging\b/i],
    ["Pet friendly", /\bpet[- ]friendly\b|\bpets? (?:ok|allowed|welcome)\b/i],
    ["Smoking allowed", /\bsmoking allowed\b/i],
    ["Utilities included", /\butilities included\b/i],
    ["Internet included", /\binternet included\b|\bwifi included\b/i],
];

export function emptyFields() {
    return {
        title: null,
        address: null,
        city: null,
        neighborhood: null,
        availableFrom: null,
        priceMonthly: null,
        priceRaw: null,
        priceIssue: null,
        roomType: null,
        beds: null,
        baths: null,
        sqft: null,
        leaseMonths: null,
        furnished: null,
        utilitiesIncluded: null,
        pets: null,
        parking: null,
    };
}

export function extractFacts(text) {
    const source = String(text || "").replace(/\s+/g, " ").trim();
    const fields = emptyFields();
    const conflicts = [];
    const notes = {};
    if (!source)
        return { fields, conflicts, notes, attributes: [], rawText: "" };
    const title = source.match(/^(.{8,80}?)(?:\.| \| | - | – )/u);
    if (title)
        fields.title = title[1].trim();
    const address = source.match(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl)\b(?:,\s*[A-Za-z .'-]+)?(?:,\s*[A-Z]{2})?(?:\s+\d{5})?/u);
    if (address) {
        fields.address = address[0].trim();
        applyPlace(fields, fields.address);
    }
    applyPlace(fields, source);
    applyRent(fields, notes, source);
    applyDate(fields, notes, source);
    applyRooms(fields, notes, source);
    const sqft = source.match(/\b(\d{3,5})\s*(?:sq\.?\s*ft|sqft|square feet|ft\s*(?:2|²))\b/i);
    if (sqft)
        fields.sqft = Number(sqft[1]);
    const lease = source.match(/\b(\d{1,2})\s*[- ]?months?\s+lease\b/i) || source.match(/\blease(?:\s+term)?\s*(?:of|:)?\s*(\d{1,2})\s*months?\b/i);
    if (lease)
        fields.leaseMonths = Number(lease[1]);
    if (/\bunfurnished\b/i.test(source))
        fields.furnished = false;
    else if (/\bfurnished\b/i.test(source))
        fields.furnished = true;
    if (/\butilities not included\b/i.test(source))
        fields.utilitiesIncluded = false;
    else if (/\butilities included\b/i.test(source))
        fields.utilitiesIncluded = true;
    if (/\bno pets\b|\bpets not allowed\b|\bno pet\b/i.test(source))
        fields.pets = "No";
    else if (/\bpet[- ]friendly\b|\bpets? (?:ok|allowed|welcome)\b/i.test(source))
        fields.pets = "Yes";
    if (/\bno parking\b|\bparking not included\b/i.test(source))
        fields.parking = "None";
    else if (/\bparking included\b|\bgarage included\b|\bcovered parking\b|\bstreet parking\b/i.test(source))
        fields.parking = source.match(/\b(?:covered parking|street parking|parking included|garage included)\b/i)?.[0] ?? "Included";
    if (/\bprivate room\b|\broom for rent\b|\bprivate bedroom\b/i.test(source))
        fields.roomType = "private_room";
    else if (/\bshared room\b|\bshared housing\b/i.test(source))
        fields.roomType = "shared";
    else if (/\bentire (?:apartment|home|unit|place)\b|\bwhole (?:apartment|home|unit)\b/i.test(source))
        fields.roomType = "entire";
    return { fields, conflicts, notes, attributes: attributesFromText(source), rawText: source };
}

export function extractFromHtml(html) {
    const raw = String(html || "");
    const structured = structuredFacts(raw);
    const text = visibleText(raw);
    const parsed = extractFacts(`${structured.preface}\n${text}`);
    const fields = { ...parsed.fields, ...compact(structured.fields) };
    const conflicts = [...parsed.conflicts];
    const notes = { ...parsed.notes, ...structured.notes };
    return {
        fields,
        conflicts,
        notes,
        attributes: mergeAttributes(parsed.attributes, structured.attributes),
        rawText: text,
    };
}

export function mergeExtractions(parts) {
    const fields = emptyFields();
    const conflicts = new Set();
    const notes = {};
    const attributes = new Map();
    const texts = [];
    for (const part of parts) {
        texts.push(part.rawText || "");
        for (const [key, value] of Object.entries(part.fields || {})) {
            if (value == null || value === "")
                continue;
            if (fields[key] == null || fields[key] === "") {
                fields[key] = value;
                if (part.notes?.[key])
                    notes[key] = part.notes[key];
                continue;
            }
            if (!sameFact(fields[key], value)) {
                conflicts.add(key);
                fields[key] = null;
                notes[key] = "Conflicting values across the submitted material. Left unknown until you choose one.";
            }
        }
        for (const attribute of part.attributes || []) {
            const existing = attributes.get(attribute.name);
            if (!existing) {
                attributes.set(attribute.name, attribute);
                continue;
            }
            if (existing.value !== attribute.value) {
                attributes.delete(attribute.name);
                conflicts.add(`attribute:${attribute.name}`);
                notes[`attribute:${attribute.name}`] = "Conflicting amenity evidence. Left unknown.";
            }
        }
        for (const conflict of part.conflicts || [])
            conflicts.add(conflict);
    }
    return {
        fields,
        conflicts: [...conflicts],
        notes,
        attributes: [...attributes.values()],
        rawText: texts.filter(Boolean).join("\n\n"),
    };
}

function compact(fields) {
    return Object.fromEntries(Object.entries(fields || {}).filter(([, value]) => value != null && value !== ""));
}

function sameFact(left, right) {
    return String(left).toLowerCase() === String(right).toLowerCase();
}

function applyPlace(fields, text) {
    if (!fields.city) {
        const city = CITIES.find((name) => new RegExp(`\\b${name}\\b`, "i").test(text));
        if (city)
            fields.city = city;
    }
    if (!fields.neighborhood) {
        const neighborhood = NEIGHBORHOODS.find((name) => new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text));
        if (neighborhood)
            fields.neighborhood = neighborhood;
    }
}

function applyRent(fields, notes, source) {
    const money = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d{2,5})(?:\.\d{2})?`;
    const weekly = [...source.matchAll(new RegExp(`${money}\\s*(?:\\/\\s*(?:wk|week)|per week|a week|weekly)`, "gi"))];
    const monthly = [...source.matchAll(new RegExp(`${money}\\s*(?:\\/\\s*mo(?:nth)?|per month|a month|monthly)`, "gi"))];
    const bare = [...source.matchAll(new RegExp(money, "gi"))];
    const monthlyAmounts = uniqueAmounts(monthly);
    const bareAmounts = uniqueAmounts(bare);
    if (monthlyAmounts.length > 1 || (monthlyAmounts.length === 1 && bareAmounts.some((amount) => amount !== monthlyAmounts[0]))) {
        fields.priceRaw = monthly[0]?.[0] || bare[0]?.[0] || null;
        fields.priceIssue = "conflict";
        notes.priceMonthly = "More than one price was found, so monthly rent was left unknown.";
        return;
    }
    if (weekly.length > 0 && monthlyAmounts.length === 0) {
        fields.priceRaw = weekly[0][0];
        fields.priceIssue = "nonmonthly";
        notes.priceMonthly = "Nonmonthly rent was kept as text and not converted into a monthly price.";
        return;
    }
    if (monthlyAmounts.length === 1) {
        fields.priceMonthly = monthlyAmounts[0];
        fields.priceRaw = monthly[0][0];
        return;
    }
    if (bareAmounts.length > 0) {
        fields.priceRaw = bare[0][0];
        fields.priceIssue = "ambiguous";
        notes.priceMonthly = "A dollar amount was found without a monthly period, so rent was left unknown.";
    }
}

function applyDate(fields, notes, source) {
    const window = source.match(/\b(?:available|move[- ]in|availability)\b.{0,48}/i)?.[0] || "";
    if (!window) {
        return;
    }
    const iso = window.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    const named = window.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i);
    if (iso) {
        fields.availableFrom = iso[1];
        return;
    }
    if (named) {
        const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
        const month = months.indexOf(named[1].toLowerCase()) + 1;
        const day = Number(named[2]);
        const year = Number(named[3]);
        const candidate = new Date(Date.UTC(year, month - 1, day));
        if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day) {
            fields.availableFrom = candidate.toISOString().slice(0, 10);
            return;
        }
    }
    notes.availableFrom = "The availability wording is ambiguous, so the date was left unknown.";
}

function uniqueAmounts(matches) {
    return [...new Set(matches.map((match) => Number(match[1].replace(/,/g, ""))))].filter((amount) => Number.isFinite(amount));
}

function applyRooms(fields, notes, source) {
    if (/\bstudio\b/i.test(source))
        fields.beds = 0;
    const beds = source.match(/\b(\d+(?:\.\d+)?)\s*(?:bedrooms?|beds?|br|bd)\b/i);
    if (beds) {
        const value = Number(beds[1]);
        if (fields.beds != null && fields.beds !== value) {
            fields.beds = null;
            notes.beds = "Bedroom count conflicted with studio wording and was left unknown.";
        }
        else {
            fields.beds = value;
        }
    }
    const baths = source.match(/\b(\d+(?:\.\d+)?)\s*(?:bathrooms?|baths?|ba)\b/i);
    if (baths)
        fields.baths = Number(baths[1]);
}

function attributesFromText(source) {
    return AMENITY_RULES.filter(([, pattern]) => pattern.test(source)).map(([name]) => ({
        name,
        value: true,
    }));
}

function visibleText(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, "\"")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100000);
}

function structuredFacts(html) {
    const fields = emptyFields();
    const notes = {};
    const attributes = [];
    const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const preface = [];
    for (const block of blocks) {
        try {
            walkJsonLd(JSON.parse(block[1]), fields, notes, attributes, preface);
        }
        catch {
            notes.jsonLd = "Structured page data could not be parsed and was ignored.";
        }
    }
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
    const title = og || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    if (title)
        fields.title = visibleText(title).split(/\s+-\s+/)[0].slice(0, 140);
    return { fields, notes, attributes, preface: preface.join(" ") };
}

function walkJsonLd(node, fields, notes, attributes, preface) {
    if (!node || typeof node !== "object")
        return;
    if (Array.isArray(node)) {
        for (const item of node)
            walkJsonLd(item, fields, notes, attributes, preface);
        return;
    }
    if (typeof node.name === "string" && !fields.title)
        fields.title = node.name.slice(0, 140);
    const address = node.address;
    if (address && typeof address === "object" && !Array.isArray(address)) {
        const line = [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode]
            .filter((part) => typeof part === "string" && part.trim())
            .join(", ");
        if (line) {
            fields.address = line;
            if (typeof address.addressLocality === "string")
                fields.city = address.addressLocality.trim();
            preface.push(line);
        }
    }
    const offer = node.offers;
    if (offer && typeof offer === "object") {
        const price = offer.price ?? offer.lowPrice;
        const period = `${offer.unitText || ""} ${offer.priceSpecification?.unitText || ""}`;
        if (price != null && /month/i.test(period)) {
            const amount = Number(price);
            if (Number.isFinite(amount) && amount >= 0) {
                fields.priceMonthly = amount;
                fields.priceRaw = String(price);
            }
        }
        else if (price != null) {
            fields.priceRaw = String(price);
            fields.priceIssue = "ambiguous";
            notes.priceMonthly = "Structured price had no monthly period, so rent was left unknown.";
        }
    }
    if (typeof node.description === "string")
        preface.push(node.description);
    for (const value of Object.values(node))
        walkJsonLd(value, fields, notes, attributes, preface);
}

function mergeAttributes(left, right) {
    const map = new Map();
    for (const item of [...left, ...right]) {
        if (!map.has(item.name))
            map.set(item.name, item);
    }
    return [...map.values()];
}
