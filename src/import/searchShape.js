export function toSearchListing(record) {
    const roomType = record.roomType ?? record.room_type ?? null;
    const monthly = numberOrNull(record.priceMonthly ?? record.price_monthly);
    const wholeUnit = roomType == null || roomType === "entire";
    const beds = numberOrNull(record.beds);
    const pets = booleanFact(record.pets);
    const parking = booleanFact(record.parking);
    return {
        id: String(record.id),
        title: record.title || record.address || "Imported listing",
        city: record.city || "",
        neighborhood: record.neighborhood || "",
        address: record.address || "",
        rent: wholeUnit ? monthly : null,
        roomRent: wholeUnit ? null : monthly,
        roomType,
        beds,
        baths: numberOrNull(record.baths),
        sqft: numberOrNull(record.sqft),
        roomLabel: roomLabel(roomType, beds),
        furnished: booleanOrNull(record.furnished),
        pets,
        parking,
        petsText: textOrUnknown(record.pets),
        parkingText: textOrUnknown(record.parking),
        leaseMonths: numberOrNull(record.leaseMonths ?? record.lease_months),
        commuteMinutes: null,
        availableFrom: record.availableFrom || record.available_from || null,
        origin: record.source === "link" ? "link" : "upload",
        sourceUrl: record.sourceUrl || record.source_url || null,
        unverified: true,
        sampleData: false,
        amenities: record.amenities || [],
    };
}

export function roomLabel(roomType, beds) {
    const size = beds == null ? "Bedrooms unknown" : beds === 0 ? "Studio" : beds === 1 ? "1 bedroom" : `${beds} bedrooms`;
    if (roomType === "private_room")
        return `${size} · private room rent`;
    if (roomType === "shared")
        return `${size} · shared room rent`;
    if (roomType === "entire")
        return `${size} · entire place`;
    return size;
}

function numberOrNull(value) {
    if (value == null || value === "")
        return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value) {
    if (value === true || value === false)
        return value;
    if (value == null || value === "")
        return null;
    return null;
}

function booleanFact(value) {
    if (value === true || value === false)
        return value;
    if (typeof value !== "string")
        return null;
    if (/^(yes|allowed|included|pet friendly|pet-friendly)$/i.test(value.trim()))
        return true;
    if (/^(no|none|not allowed|no pets)$/i.test(value.trim()))
        return false;
    return null;
}

function textOrUnknown(value) {
    if (value == null || value === "")
        return "Unknown";
    if (value === true)
        return "Yes";
    if (value === false)
        return "No";
    return String(value);
}
