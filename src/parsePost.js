const CITIES = [
  "Mountain View",
  "Redwood City",
  "Menlo Park",
  "Santa Clara",
  "San Jose",
  "Los Gatos",
  "Sunnyvale",
  "Cupertino",
  "Palo Alto",
  "Campbell",
  "Milpitas",
  "Saratoga",
  "Fremont",
];

const NEIGHBORHOODS = [
  "Downtown Sunnyvale",
  "Santa Clara University",
  "Cupertino Village",
  "Downtown San Jose",
  "Castro Street",
  "Santana Row",
];

export function parseGroupPost(post) {
  const text = post.text.replace(/\s+/g, " ").trim();
  if (!post.postId || !post.postUrl || !text) return { accepted: false, reason: "invalid" };
  if (isWanted(text)) return { accepted: false, reason: "wanted" };
  if (!isOffer(text) && post.listingCategory !== "apartment") return { accepted: false, reason: "unrelated" };

  const scope = unitScope(text, post.listingCategory);
  const offerKind = offerKindFor(text, scope);
  const rent = extractRent(text, scope, post.listingCategory);
  const beds = extractBeds(text);
  const cities = mentioned(text, CITIES);
  const neighborhoods = mentioned(text, NEIGHBORHOODS);
  const city = cities.length === 1 ? cities[0] : "";
  const neighborhood = neighborhoods.length === 1 ? neighborhoods[0] : "";
  const listing = {
    id: `${post.listingCategory === "apartment" ? "cl" : "fb"}-${post.groupId}-${post.postId}`,
    title: titleFrom(post.title || text, post.postId),
    city,
    neighborhood,
    rent: rent.amount,
    beds,
    sqft: extractSqft(text),
    roomLabel: roomLabel(offerKind, scope, beds),
    furnished: triState(text, /\bunfurnished\b/i, /\bfurnished\b/i),
    pets: triState(text, /\b(no pets|pets not allowed|no animals)\b/i, /\b(pet[- ]friendly|pets?\s+(ok|okay|allowed|welcome)|cats?\s+ok|dogs?\s+ok)\b/i),
    parking: triState(text, /\bno parking\b/i, /\b(parking included|garage included|dedicated (parking )?spot|parking spot)\b/i),
    leaseMonths: extractLeaseMonths(text),
    commuteMinutes: null,
    origin: "imported",
    offerKind,
    rentBasis: rent.basis,
    sourceGroup: post.groupLabel,
    sourceGroupId: post.groupId,
    sourcePostId: post.postId,
    sourceUrl: post.postUrl.split("?")[0],
    postedAt: post.postedAt,
    importedAt: post.fetchedAt,
    availability: extractAvailability(text),
  };
  return { accepted: true, listing };
}

function isWanted(text) {
  const wanted = /\b(looking for|iso\b|in search of|seeking|need(?:ing)?(?:\s+\w+){0,2}\s+(?:a |an )?)\b/i.test(text);
  if (!wanted) return false;
  if (/\b(for rent|available|sublet|sublease|offering|my (room|apartment|place)|i have)\b/i.test(text)) return false;
  if (/\broommates?\b/i.test(text) && /\$\s?\d/.test(text)) return false;
  return true;
}

function isOffer(text) {
  if (!/\b(room|roommate|apartment|apt|studio|house|sublet|sublease|bedroom|br\b|lease|housing)\b/i.test(text)) {
    return false;
  }
  return /\b(for rent|available|sublet|sublease|offering)\b|\$\s?\d|\b\d{3,4}\s*\/\s*(month|mo|week|wk)\b/i.test(text);
}

function unitScope(text, category) {
  const room = /\b(private room|room for rent|roommate|shared room|a room|my room)\b/i.test(text);
  const whole = /\b(entire|whole (apartment|house|unit)|apartment for rent|house for rent|studio|full apartment|my apartment)\b/i.test(text);
  if (room && !whole) return "room";
  if (whole && !room) return "unit";
  if (room && whole) return /\broom in\b/i.test(text) ? "room" : "unknown";
  if (category === "apartment") return "unit";
  return "unknown";
}

function offerKindFor(text, scope) {
  if (/sublet|sublease/i.test(text)) return "sublet";
  if (scope === "room") return "room";
  if (scope === "unit") return "whole";
  return "unknown";
}

function extractRent(text, scope, category) {
  const matches = [...text.matchAll(/\$\s?(\d{1,2}(?:,\d{3})+|\d{3,5})(?:\s*(?:\/|per)\s*(month|mo|week|wk|day|night|year|yr))?/gi)];
  const plain = [...text.matchAll(/(?<![\d$,])(\d{3,5})\s*(?:\/|per)\s*(month|mo|week|wk|day|night|year|yr)\b/gi)];
  const amounts = [
    ...matches.map((match) => ({ amount: Number(match[1].replace(/,/g, "")), period: normalizePeriod(match[2]) })),
    ...plain.map((match) => ({ amount: Number(match[1]), period: normalizePeriod(match[2]) })),
  ].filter((item) => item.amount >= 100 && item.amount <= 20000);
  const unique = dedupeAmounts(amounts);
  if (unique.length === 0) return { amount: null, basis: "unknown" };
  const monthly = unique.filter((item) => item.period === "month");
  const other = unique.filter((item) => item.period && item.period !== "month");
  if (monthly.length === 1 && other.length === 0) {
    return { amount: monthly[0].amount, basis: scope === "room" ? "monthly-room" : scope === "unit" ? "monthly-total" : "unknown" };
  }
  if (monthly.length === 0 && other.length === 1 && unique.length === 1) {
    return { amount: other[0].amount, basis: "nonmonthly" };
  }
  if (unique.length === 1 && unique[0].period == null) {
    if (category === "apartment") {
      return { amount: unique[0].amount, basis: scope === "room" ? "monthly-room" : "monthly-total" };
    }
    return { amount: unique[0].amount, basis: "unknown" };
  }
  return { amount: null, basis: "unknown" };
}

function normalizePeriod(value) {
  if (!value) return null;
  if (/^(month|mo)$/i.test(value)) return "month";
  return "other";
}

function dedupeAmounts(amounts) {
  const seen = new Set();
  const unique = [];
  for (const item of amounts) {
    const key = `${item.amount}:${item.period ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function extractBeds(text) {
  if (/\bstudio\b/i.test(text)) return 0;
  const match = text.match(/\b(\d+)\s*(?:bed(?:room)?s?|br)\b/i);
  if (!match) return null;
  const beds = Number(match[1]);
  return beds >= 0 && beds <= 12 ? beds : null;
}

function extractSqft(text) {
  const match = text.match(/\b(\d{3,4})\s*(?:sq\.?\s*ft|sqft|square feet)\b/i);
  if (!match) return null;
  const sqft = Number(match[1]);
  return sqft >= 50 && sqft <= 10000 ? sqft : null;
}

function extractLeaseMonths(text) {
  const match = text.match(/\b(\d+)\s*-?\s*months?\s*(?:lease|term)\b/i);
  if (!match) return null;
  const months = Number(match[1]);
  return months > 0 && months <= 36 ? months : null;
}

function extractAvailability(text) {
  const matches = [...text.matchAll(/\bavailable(?:\s+(?:now|immediately|on\s+[A-Za-z]+\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?))?/gi)];
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b[0].length - a[0].length)[0][0];
}

function mentioned(text, names) {
  return names.filter((name) => new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
}

function triState(text, negative, positive) {
  const no = negative.test(text);
  const yes = positive.test(text);
  if (yes === no) return null;
  return yes;
}

function titleFrom(text, postId) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return `Imported post ${postId}`;
  return compact.length > 90 ? `${compact.slice(0, 87)}...` : compact;
}

function roomLabel(kind, scope, beds) {
  if (kind === "sublet") {
    if (scope === "room") return "Sublet, room";
    if (scope === "unit") return beds === 0 ? "Sublet, studio" : "Sublet, whole unit";
    return "Sublet";
  }
  if (scope === "room") return beds != null && beds > 0 ? `${beds} bedroom room` : "Private room";
  if (beds === 0) return "Studio";
  if (beds != null) return beds === 1 ? "1 bedroom" : `${beds} bedrooms`;
  return "Offer type unknown";
}
