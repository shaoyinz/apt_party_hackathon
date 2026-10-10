import { preferenceWeightScore } from "./matching";
import { DEMO_SCORE_NOTE, PREFERENCE_SCORE_NOTE } from "./model";

const FACT_FIELDS = [
    ["address", "Address"],
    ["rent", "Rent"],
    ["beds", "Bedrooms"],
    ["commuteMinutes", "Sample commute"],
    ["contact", "Contact"],
    ["pets", "Pets"],
    ["parking", "Parking"],
    ["furnished", "Furnished"],
    ["source", "Source"],
    ["listedOn", "Listed date"],
];

export function createId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID)
        return crypto.randomUUID();
    return `id-${Math.random().toString(36).slice(2, 12)}`;
}

export function createGroup(name, memberName, ids = createId) {
    const groupName = name.trim();
    const display = memberName.trim();
    if (!groupName)
        return { error: "Enter a group name.", group: null, member: null };
    if (!display)
        return { error: "Enter a display name.", group: null, member: null };
    const member = { id: ids(), name: display, commuteDestinationId: null };
    const group = emptyGroup(groupName, member, ids);
    return { error: null, group, member };
}

export function joinGroup(group, memberName, ids = createId) {
    const display = memberName.trim();
    if (!display)
        return { error: "Enter a display name.", group, member: null };
    const member = { id: ids(), name: display, commuteDestinationId: null };
    return { error: null, member, group: { ...group, members: [...group.members, member] } };
}

export function findInvite(groups, token) {
    const current = groups.find((group) => group.inviteToken === token);
    if (current)
        return { status: "ok", group: current };
    const revoked = groups.find((group) => group.revokedTokens.includes(token));
    if (revoked)
        return { status: "revoked", group: revoked };
    return { status: "unavailable", group: null };
}

export function regenerateInvite(group, ids = createId) {
    return {
        ...group,
        revokedTokens: [...group.revokedTokens, group.inviteToken],
        inviteToken: ids(),
    };
}

export function renameMember(group, memberId, name) {
    const display = name.trim();
    if (!display)
        return { error: "Enter a display name.", group };
    return {
        error: null,
        group: {
            ...group,
            members: group.members.map((member) => (member.id === memberId ? { ...member, name: display } : member)),
        },
    };
}

export function setMemberDestination(group, memberId, destinationId) {
    const commuteDestinationId = destinationId || null;
    return {
        ...group,
        members: group.members.map((member) => (member.id === memberId ? { ...member, commuteDestinationId } : member)),
    };
}

export function removeMember(group, memberId) {
    if (!group.members.some((member) => member.id === memberId))
        return { error: "That member is not in this group.", group };
    if (group.members.length <= 1)
        return { error: "Keep at least one demo member in the group.", group };
    const removed = group.members.find((member) => member.id === memberId);
    return {
        error: null,
        group: {
            ...group,
            members: group.members.filter((member) => member.id !== memberId),
            removedMembers: [...group.removedMembers, removed],
            votes: stripMember(group.votes, memberId),
            vetoes: stripMember(group.vetoes, memberId),
        },
    };
}

export function addShortlist(group, listingId) {
    if (group.shortlist.includes(listingId))
        return group;
    return { ...group, shortlist: [...group.shortlist, listingId] };
}

export function removeShortlist(group, listingId) {
    return {
        ...group,
        shortlist: group.shortlist.filter((id) => id !== listingId),
        touring: group.touring.filter((id) => id !== listingId),
    };
}

export function setTouring(group, listingId, touring) {
    if (!group.shortlist.includes(listingId))
        return group;
    const next = new Set(group.touring);
    if (touring)
        next.add(listingId);
    else
        next.delete(listingId);
    return { ...group, touring: [...next] };
}

export function listingStatus(group, listingId) {
    if (group.touring.includes(listingId))
        return "touring";
    if (group.shortlist.includes(listingId))
        return "shortlisted";
    return "open";
}

export function toggleSignal(group, listingId, memberId, kind) {
    const key = kind === "veto" ? "vetoes" : "votes";
    const current = group[key][listingId] ?? [];
    const next = current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId];
    return { ...group, [key]: { ...group[key], [listingId]: next } };
}

export function currentSignalIds(group, listingId, kind) {
    const key = kind === "veto" ? "vetoes" : "votes";
    const active = new Set(group.members.map((member) => member.id));
    return (group[key][listingId] ?? []).filter((id) => active.has(id));
}

export function addNote(group, listingId, member, text, kind, ids = createId) {
    const trimmed = text.trim();
    if (!trimmed)
        return { error: kind === "question" ? "Enter a tour question." : "Enter a comment.", group };
    const key = kind === "question" ? "questions" : "comments";
    const note = {
        id: ids(),
        listingId,
        memberId: member.id,
        memberName: member.name,
        text: trimmed,
    };
    return { error: null, group: { ...group, [key]: [...group[key], note] } };
}

export function updateQuestion(group, questionId, text) {
    const trimmed = text.trim();
    if (!trimmed)
        return { error: "Enter a tour question.", group };
    return {
        error: null,
        group: {
            ...group,
            questions: group.questions.map((question) => (question.id === questionId ? { ...question, text: trimmed } : question)),
        },
    };
}

export function revealContact(group, listing, member) {
    if (!listing.contact)
        return { error: "Contact is Not listed.", group };
    return {
        error: null,
        group: {
            ...group,
            revealed: {
                ...group.revealed,
                [listing.id]: { memberId: member.id, memberName: member.name },
            },
        },
    };
}

export function missingFacts(listing) {
    return FACT_FIELDS.filter(([key]) => listing[key] == null).map(([, label]) => ({
        listingId: listing.id,
        title: listing.title,
        label,
    }));
}

export function factText(value, format) {
    if (value == null || value === "")
        return "Not listed";
    return format ? format(value) : String(value);
}

export function groupScore(listing, priorities) {
    if (priorities.length)
        return { value: preferenceWeightScore(listing, priorities), note: PREFERENCE_SCORE_NOTE, kind: "preference" };
    return { value: demoGroupScore(listing), note: DEMO_SCORE_NOTE, kind: "demo" };
}

export function demoGroupScore(listing) {
    let score = 5;
    if (listing.rent != null)
        score += clamp(listing.rent, 4000, 1000);
    if (listing.commuteMinutes != null)
        score += clamp(listing.commuteMinutes, 30, 20);
    if (listing.beds != null)
        score += Math.min(listing.beds, 4) * 0.2;
    return Math.round(score * 10) / 10;
}

export function bestValueIds(listings) {
    const known = listings.filter((listing) => listing.rent != null);
    if (!known.length)
        return new Set();
    const min = Math.min(...known.map((listing) => listing.rent));
    return new Set(known.filter((listing) => listing.rent === min).map((listing) => listing.id));
}

export function memberCommute(listing, member) {
    if (!member || member.commuteDestinationId !== "mv-caltrain")
        return null;
    return listing.commuteMinutes ?? null;
}

export function perPersonRent(rent, memberCount) {
    if (rent == null || !memberCount)
        return null;
    return rent / memberCount;
}

export function validateFilters(draft) {
    const errors = {};
    const minPrice = parseOptionalNumber(draft.minPrice);
    const maxPrice = parseOptionalNumber(draft.maxPrice);
    const minBeds = parseOptionalNumber(draft.minBeds);
    const maxCommute = parseOptionalNumber(draft.maxCommute);
    if (minPrice === false)
        errors.minPrice = "Enter a price of 0 or more, or leave it blank.";
    if (maxPrice === false)
        errors.maxPrice = "Enter a price of 0 or more, or leave it blank.";
    if (minBeds === false || (minBeds != null && !Number.isInteger(minBeds)))
        errors.minBeds = "Enter a whole number of bedrooms, or leave it blank.";
    if (maxCommute === false)
        errors.maxCommute = "Enter a maximum commute in minutes, or leave it blank.";
    if (typeof minPrice === "number" && typeof maxPrice === "number" && minPrice > maxPrice)
        errors.maxPrice = "Maximum price must be at least the minimum.";
    return {
        errors,
        parsed: {
            minPrice: typeof minPrice === "number" ? minPrice : null,
            maxPrice: typeof maxPrice === "number" ? maxPrice : null,
            minBeds: typeof minBeds === "number" ? minBeds : null,
            maxCommute: typeof maxCommute === "number" ? maxCommute : null,
        },
    };
}

export function filterListings(listings, group, filters) {
    const text = filters.text.trim().toLowerCase();
    return listings.filter((listing) => {
        if (text) {
            const haystack = [listing.title, listing.neighborhood, listing.address]
                .filter((part) => part)
                .join("\n")
                .toLowerCase();
            if (!haystack.includes(text))
                return false;
        }
        if (filters.minPrice != null || filters.maxPrice != null) {
            if (listing.rent == null)
                return false;
            if (filters.minPrice != null && listing.rent < filters.minPrice)
                return false;
            if (filters.maxPrice != null && listing.rent > filters.maxPrice)
                return false;
        }
        if (filters.minBeds != null && (listing.beds == null || listing.beds < filters.minBeds))
            return false;
        if (filters.maxCommute != null && (listing.commuteMinutes == null || listing.commuteMinutes > filters.maxCommute))
            return false;
        if (filters.status !== "any" && listingStatus(group, listing.id) !== filters.status)
            return false;
        if (filters.source !== "any" && listing.source !== filters.source)
            return false;
        return true;
    });
}

export function sortListings(listings, sort, scoreOf) {
    return [...listings].sort((left, right) => compareSort(left, right, sort, scoreOf) || left.id.localeCompare(right.id));
}

export function shortlistSummary(listings, scoreOf) {
    const rents = known(listings, (listing) => listing.rent);
    const commutes = known(listings, (listing) => listing.commuteMinutes);
    const scores = known(listings, scoreOf);
    return {
        rentRange: rents.length
            ? { min: Math.min(...rents), max: Math.max(...rents), known: rents.length, total: listings.length }
            : null,
        avgCommute: commutes.length
            ? { value: round1(average(commutes)), known: commutes.length, total: listings.length }
            : null,
        avgScore: scores.length
            ? { value: round1(average(scores)), known: scores.length, total: listings.length }
            : null,
        missing: listings.flatMap(missingFacts),
    };
}

export function sanitizeGroups(value) {
    if (value == null)
        return { groups: [], ok: true };
    if (!Array.isArray(value))
        return { groups: [], ok: false };
    const groups = [];
    for (const item of value) {
        const group = sanitizeGroup(item);
        if (!group)
            return { groups: [], ok: false };
        groups.push(group);
    }
    return { groups, ok: true };
}

function emptyGroup(name, member, ids) {
    return {
        id: ids(),
        name,
        inviteToken: ids(),
        revokedTokens: [],
        members: [member],
        removedMembers: [],
        shortlist: [],
        touring: [],
        votes: {},
        vetoes: {},
        comments: [],
        questions: [],
        revealed: {},
    };
}

function sanitizeGroup(value) {
    if (!value || typeof value !== "object")
        return null;
    if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.inviteToken !== "string")
        return null;
    if (!Array.isArray(value.members) || value.members.some((member) => !member || typeof member.id !== "string" || typeof member.name !== "string"))
        return null;
    return {
        id: value.id,
        name: value.name,
        inviteToken: value.inviteToken,
        revokedTokens: stringList(value.revokedTokens),
        members: value.members.map((member) => ({
            id: member.id,
            name: member.name,
            commuteDestinationId: typeof member.commuteDestinationId === "string" ? member.commuteDestinationId : null,
        })),
        removedMembers: Array.isArray(value.removedMembers)
            ? value.removedMembers.filter((member) => member && typeof member.id === "string" && typeof member.name === "string").map((member) => ({ id: member.id, name: member.name }))
            : [],
        shortlist: stringList(value.shortlist),
        touring: stringList(value.touring),
        votes: stringMap(value.votes),
        vetoes: stringMap(value.vetoes),
        comments: noteList(value.comments),
        questions: noteList(value.questions),
        revealed: revealMap(value.revealed),
    };
}

function stringList(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === "string");
}

function stringMap(value) {
    if (!value || typeof value !== "object")
        return {};
    const next = {};
    for (const [key, ids] of Object.entries(value))
        next[key] = stringList(ids);
    return next;
}

function noteList(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((note) => note && typeof note.id === "string" && typeof note.listingId === "string" && typeof note.memberName === "string" && typeof note.text === "string").map((note) => ({
        id: note.id,
        listingId: note.listingId,
        memberId: typeof note.memberId === "string" ? note.memberId : "",
        memberName: note.memberName,
        text: note.text,
    }));
}

function revealMap(value) {
    if (!value || typeof value !== "object")
        return {};
    const next = {};
    for (const [key, item] of Object.entries(value)) {
        if (item && typeof item.memberName === "string")
            next[key] = { memberId: typeof item.memberId === "string" ? item.memberId : "", memberName: item.memberName };
    }
    return next;
}

function stripMember(map, memberId) {
    const next = {};
    for (const [listingId, ids] of Object.entries(map))
        next[listingId] = ids.filter((id) => id !== memberId);
    return next;
}

function clamp(value, center, span) {
    return Math.max(-2, Math.min(2, (center - value) / span));
}

function parseOptionalNumber(value) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed)
        return null;
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed))
        return false;
    const number = Number(trimmed);
    if (!Number.isFinite(number) || number < 0)
        return false;
    return number;
}

function compareSort(left, right, sort, scoreOf) {
    if (sort === "price")
        return compareKnown(left.rent, right.rent, true);
    if (sort === "commute")
        return compareKnown(left.commuteMinutes, right.commuteMinutes, true);
    if (sort === "newest")
        return compareKnown(left.listedOn, right.listedOn, false);
    return compareKnown(scoreOf(left), scoreOf(right), false);
}

function compareKnown(left, right, ascending) {
    if (left == null && right == null)
        return 0;
    if (left == null)
        return 1;
    if (right == null)
        return -1;
    if (left === right)
        return 0;
    const order = left < right ? -1 : 1;
    return ascending ? order : -order;
}

function known(listings, read) {
    return listings.map(read).filter((value) => value != null && Number.isFinite(value));
}

function average(values) {
    return values.reduce((total, value) => total + value, 0) / values.length;
}

function round1(value) {
    return Math.round(value * 10) / 10;
}
