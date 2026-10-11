import { randomBytes, randomUUID } from "node:crypto";

export function createMemoryRepository() {
    const groups = new Map();
    const members = new Map();
    const listings = new Map();
    const attributes = new Map();
    const locks = new Map();
    function remember(groupId, memberId, name, inviteCode) {
        return { groupId, memberId, name, inviteCode };
    }
    return {
        kind: "memory",
        async ensureMember(label) {
            const groupId = randomUUID();
            const memberId = randomUUID();
            let inviteCode = randomBytes(4).toString("hex");
            while ([...groups.values()].some((group) => group.inviteCode === inviteCode))
                inviteCode = randomBytes(4).toString("hex");
            groups.set(groupId, { id: groupId, name: label, inviteCode });
            members.set(memberId, { id: memberId, groupId, name: label });
            return remember(groupId, memberId, label, inviteCode);
        },
        async joinByCode(name, code, currentMemberId) {
            const group = [...groups.values()].find((item) => item.inviteCode === code);
            if (!group)
                return null;
            if (currentMemberId) {
                const current = members.get(currentMemberId);
                if (current && current.groupId === group.id)
                    return remember(group.id, current.id, current.name, group.inviteCode);
            }
            const memberId = randomUUID();
            members.set(memberId, { id: memberId, groupId: group.id, name });
            return remember(group.id, memberId, name, group.inviteCode);
        },
        async pageIdentity(groupId, memberId) {
            const member = members.get(memberId);
            const group = groups.get(groupId);
            if (!member || !group || member.groupId !== groupId)
                return null;
            return remember(groupId, memberId, member.name, group.inviteCode);
        },
        async memberInGroup(memberId, groupId) {
            const member = members.get(memberId);
            return Boolean(member && member.groupId === groupId && groups.has(groupId));
        },
        async findIdempotent(groupId, idempotencyKey) {
            const existing = [...listings.values()].find((row) => row.group_id === groupId && row.field_confidence.idempotencyKey === idempotencyKey);
            return existing ? publicListing(existing, attributes.get(existing.id) || []) : null;
        },
        async saveImport(input) {
            const key = `${input.groupId}:${input.idempotencyKey}`;
            while (locks.get(key))
                await locks.get(key);
            let release;
            const gate = new Promise((resolve) => {
                release = resolve;
            });
            locks.set(key, gate);
            try {
                const existing = [...listings.values()].find((row) => row.group_id === input.groupId && row.field_confidence.idempotencyKey === input.idempotencyKey);
                if (existing)
                    return { id: existing.id, created: false, listing: publicListing(existing, attributes.get(existing.id) || []) };
                if (input.failAfterListing)
                    throw new Error("forced partial failure");
                const id = input.id || randomUUID();
                const row = {
                    id,
                    group_id: input.groupId,
                    created_by: input.memberId,
                    source: input.record.source,
                    source_url: input.record.sourceUrl,
                    image_urls: input.record.imageUrls,
                    raw_text: input.record.rawText,
                    title: input.record.title,
                    address: input.record.address,
                    city: input.record.city,
                    neighborhood: input.record.neighborhood,
                    price_monthly: input.record.priceMonthly,
                    room_type: input.record.roomType,
                    beds: input.record.beds,
                    baths: input.record.baths,
                    sqft: input.record.sqft,
                    available_from: input.record.availableFrom,
                    lease_months: input.record.leaseMonths,
                    furnished: input.record.furnished,
                    utilities_included: input.record.utilitiesIncluded,
                    pets: input.record.pets,
                    parking: input.record.parking,
                    status: "New",
                    field_confidence: input.record.fieldConfidence,
                };
                listings.set(id, row);
                attributes.set(id, input.attributes.map((item) => ({ ...item, verified: false })));
                return { id, created: true, listing: publicListing(row, attributes.get(id)) };
            }
            finally {
                locks.delete(key);
                release();
            }
        },
        async listGroup(groupId) {
            return [...listings.values()]
                .filter((row) => row.group_id === groupId)
                .map((row) => publicListing(row, attributes.get(row.id) || []));
        },
        async getForGroup(listingId, groupId) {
            const row = listings.get(listingId);
            if (!row || row.group_id !== groupId)
                return null;
            return publicListing(row, attributes.get(row.id) || []);
        },
        async updateImportLocation(input) {
            const row = listings.get(input.id);
            if (!row || row.group_id !== input.groupId)
                return null;
            row.address = input.address;
            row.city = input.city;
            const confidence = { ...(row.field_confidence || {}), city: input.city };
            if (input.location)
                confidence.location = input.location;
            else
                delete confidence.location;
            row.field_confidence = confidence;
            return publicListing(row, attributes.get(row.id) || []);
        },
    };
}

function publicListing(row, attrs) {
    return {
        id: row.id,
        source: row.source,
        sourceUrl: row.source_url,
        imageUrls: row.image_urls,
        rawText: row.raw_text,
        title: row.title,
        address: row.address,
        city: row.city,
        neighborhood: row.neighborhood,
        priceMonthly: row.price_monthly,
        roomType: row.room_type,
        beds: row.beds,
        baths: row.baths,
        sqft: row.sqft,
        availableFrom: row.available_from,
        leaseMonths: row.lease_months,
        furnished: row.furnished,
        utilitiesIncluded: row.utilities_included,
        pets: row.pets,
        parking: row.parking,
        status: row.status,
        amenities: attrs.map((item) => item.name),
        fieldConfidence: row.field_confidence,
        location: row.field_confidence?.location || null,
    };
}
