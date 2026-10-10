import { distanceMeters } from "../../src/location/geo.js";
import { convenienceFromElements } from "../../src/location/score.js";
import { nearestStopMeters, planTransit } from "../../src/location/plan.js";
import { classifyPlaces, interpretOsrm, suggestionPlaces } from "../../src/location/places.js";
import { parsePacificLocal } from "../../src/location/time.js";
import { getTransitGraph, userAgent } from "./gtfs.mjs";
const PHOTON = process.env.PHOTON_BASE_URL || "https://photon.komoot.io";
const OSRM = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
const NOMINATIM = process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";
const OVERPASS = (process.env.OVERPASS_URLS ||
    "https://lz4.overpass-api.de/api/interpreter,https://overpass.openstreetmap.fr/api/interpreter,https://overpass.osm.ch/api/interpreter")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const PROFILES = { driving: "driving", cycling: "bike", walking: "foot" };
const STREET_SOURCE = "OpenStreetMap via OSRM";
const AMENITY_SOURCE = "OpenStreetMap via Overpass";
const TRANSIT_SOURCE = "VTA and Caltrain GTFS with OpenStreetMap walking connections";
const geocodeCache = new Map();
const suggestCache = new Map();
const amenityCache = new Map();
export async function geocodeQuery(query) {
    const trimmed = String(query ?? "").trim();
    if (!trimmed)
        return { status: "not_found", message: "Enter a destination.", candidates: [] };
    if (geocodeCache.has(trimmed))
        return geocodeCache.get(trimmed);
    const url = new URL("/search", NOMINATIM);
    url.searchParams.set("q", trimmed);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", "us");
    url.searchParams.set("viewbox", "-122.55,37.85,-121.65,37.15");
    const response = await fetch(url, { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(20000) });
    if (!response.ok)
        return { status: "provider_failure", message: "Geocoding failed. Retry to try again.", candidates: [] };
    const result = classifyPlaces(await response.json());
    if (result.status === "ok" || result.status === "ambiguous" || result.status === "not_found")
        geocodeCache.set(trimmed, result);
    return result;
}
export async function suggestQuery(query) {
    const trimmed = String(query ?? "").trim();
    if (trimmed.length < 2)
        return { status: "ok", suggestions: [] };
    const key = trimmed.toLowerCase();
    if (suggestCache.has(key))
        return suggestCache.get(key);
    const url = new URL("/api/", PHOTON);
    url.searchParams.set("q", trimmed);
    url.searchParams.set("limit", "6");
    url.searchParams.set("lat", "37.37");
    url.searchParams.set("lon", "-122.04");
    url.searchParams.set("lang", "en");
    try {
        const response = await fetch(url, { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(8000) });
        if (!response.ok)
            return { status: "provider_failure", suggestions: [], message: "Address suggestions are unavailable." };
        const body = await response.json();
        const result = { status: "ok", suggestions: suggestionPlaces(body.features) };
        suggestCache.set(key, result);
        return result;
    }
    catch {
        return { status: "provider_failure", suggestions: [], message: "Address suggestions are unavailable." };
    }
}
export async function routeOrigins(body) {
    const mode = body?.mode;
    const destination = body?.destination;
    const origins = Array.isArray(body?.origins) ? body.origins : [];
    if (!destination || !Number.isFinite(destination.lat) || !Number.isFinite(destination.lon)) {
        return { status: "not_found", message: "Choose a destination before calculating a commute.", results: {} };
    }
    if (mode === "transit" && process.env.OTP_BASE_URL)
        return routeOtp(origins, destination, body.departure);
    if (mode === "transit")
        return routeTransit(origins, destination, body.departure);
    if (!PROFILES[mode])
        return { status: "provider_failure", message: "Choose driving, cycling, walking, or public transit.", results: {} };
    const results = {};
    await mapPool(origins, 4, async (origin) => {
        results[origin.id] = await streetOrigin(mode, origin, destination);
    });
    return { status: "ok", source: STREET_SOURCE, mode, traffic: false, results };
}
export async function amenityOrigins(origins) {
    const results = {};
    let providerFailure = null;
    await mapPool(origins, 2, async (origin) => {
        if (!Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lon)) {
            results[origin.id] = missingLocation();
            return;
        }
        const key = `${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}`;
        if (amenityCache.has(key)) {
            results[origin.id] = amenityCache.get(key);
            return;
        }
        const queried = await overpass(origin);
        if (queried.status !== "ok") {
            providerFailure = queried;
            results[origin.id] = {
                status: "provider_failure",
                message: "Amenity data is unavailable. This is not a zero score.",
                source: AMENITY_SOURCE,
            };
            return;
        }
        const scored = convenienceFromElements(queried.elements, origin);
        const value = {
            status: "ok",
            score: scored.score,
            categories: scored.categories,
            source: AMENITY_SOURCE,
            method: "Nearest unique mapped feature per category, by geographic distance within 1 km. Not a walking route.",
            message: "OpenStreetMap may omit real amenities.",
        };
        amenityCache.set(key, value);
        results[origin.id] = value;
    });
    return { status: providerFailure ? "partial" : "ok", source: AMENITY_SOURCE, results };
}
async function streetOrigin(mode, origin, destination) {
    if (!Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lon))
        return missingLocation();
    const interpreted = await osrmRoute(PROFILES[mode], origin, destination);
    if (interpreted.status !== "ok")
        return { ...interpreted, source: STREET_SOURCE, mode };
    const traffic = mode === "driving" ? " OpenStreetMap driving estimate without live traffic." : " OpenStreetMap route estimate.";
    return {
        status: "ok",
        minutes: interpreted.minutes,
        mode,
        source: STREET_SOURCE,
        traffic: mode === "driving" ? false : undefined,
        message: `${interpreted.minutes} min ${mode}.${traffic}`,
    };
}
async function routeOtp(origins, destination, departureText) {
    const departure = parsePacificLocal(departureText);
    if (!departure.ok)
        return providerRoutes(origins, "Enter a valid departure date and time. Times use America/Los_Angeles.");
    const [year, month, day] = departure.ymd.split("-");
    const hour = String(Math.floor(departure.seconds / 3600)).padStart(2, "0");
    const minute = String(Math.floor((departure.seconds % 3600) / 60)).padStart(2, "0");
    const results = {};
    for (const origin of origins) {
        if (!Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lon)) {
            results[origin.id] = missingLocation();
            continue;
        }
        const url = new URL("/otp/routers/default/plan", process.env.OTP_BASE_URL);
        url.searchParams.set("fromPlace", `${origin.lat},${origin.lon}`);
        url.searchParams.set("toPlace", `${destination.lat},${destination.lon}`);
        url.searchParams.set("time", `${hour}:${minute}`);
        url.searchParams.set("date", `${month}-${day}-${year}`);
        url.searchParams.set("mode", "TRANSIT,WALK");
        url.searchParams.set("arriveBy", "false");
        url.searchParams.set("numItineraries", "1");
        try {
            const response = await fetch(url, { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(30000) });
            if (!response.ok) {
                results[origin.id] = { status: "provider_failure", message: "OpenTripPlanner failed. Retry to try again.", source: "OpenTripPlanner" };
                continue;
            }
            const body = await response.json();
            const itinerary = body.plan?.itineraries?.[0];
            if (!itinerary) {
                results[origin.id] = { status: "no_service", message: "OpenTripPlanner found no scheduled journey.", source: "OpenTripPlanner", timezone: "America/Los_Angeles" };
                continue;
            }
            const lines = (itinerary.legs ?? []).filter((leg) => leg.transitLeg).map((leg) => leg.routeShortName || leg.route || "Transit");
            results[origin.id] = {
                status: "ok",
                minutes: Math.round(itinerary.duration / 60),
                transfers: itinerary.transfers ?? 0,
                lines,
                departureTime: pacificEpoch(itinerary.startTime),
                arrivalTime: pacificEpoch(itinerary.endTime),
                timezone: "America/Los_Angeles",
                label: "Scheduled estimate",
                source: "OpenTripPlanner with OSM and GTFS",
                message: `${Math.round(itinerary.duration / 60)} min scheduled transit. Not live delays or fares.`,
            };
        }
        catch {
            results[origin.id] = { status: "provider_failure", message: "OpenTripPlanner failed. Retry to try again.", source: "OpenTripPlanner" };
        }
    }
    return { status: "ok", source: "OpenTripPlanner", mode: "transit", timezone: "America/Los_Angeles", results };
}
function pacificEpoch(epochMs) {
    if (!Number.isFinite(epochMs))
        return "Unknown PT";
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
    }).format(new Date(epochMs));
}
async function routeTransit(origins, destination, departureText) {
    const departure = parsePacificLocal(departureText);
    if (!departure.ok) {
        return {
            status: "invalid_departure",
            message: "Enter a valid departure date and time. Times use America/Los_Angeles.",
            timezone: "America/Los_Angeles",
            results: Object.fromEntries(origins.map((origin) => [origin.id, {
                status: "invalid_departure",
                message: "Enter a valid departure date and time. Times use America/Los_Angeles.",
                timezone: "America/Los_Angeles",
            }])),
        };
    }
    let graph;
    try {
        graph = await getTransitGraph();
    }
    catch {
        return {
            status: "unsupported_coverage",
            message: "VTA and Caltrain schedules are not loaded, so transit coverage is unavailable.",
            results: {},
        };
    }
    if (nearestStopMeters(graph.stops, destination) > 20000) {
        return {
            status: "unsupported_coverage",
            message: "This destination is outside initial VTA and Caltrain coverage.",
            timezone: "America/Los_Angeles",
            results: Object.fromEntries(origins.map((origin) => [origin.id, unsupported()])),
        };
    }
    const destStops = candidates(graph, destination);
    const egressWalk = await walkTable(destination, destStops, true);
    if (!egressWalk)
        return providerRoutes(origins, "Walking connections could not be calculated, so this transit result is unavailable.");
    const results = {};
    for (const origin of origins) {
        if (!Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lon)) {
            results[origin.id] = missingLocation();
            continue;
        }
        if (nearestStopMeters(graph.stops, origin) > 20000) {
            results[origin.id] = unsupported();
            continue;
        }
        const originStops = candidates(graph, origin);
        const accessWalk = await walkTable(origin, originStops, false);
        if (!accessWalk) {
            results[origin.id] = {
                status: "provider_failure",
                message: "Walking connections could not be calculated, so this transit result is unavailable.",
                source: TRANSIT_SOURCE,
            };
            continue;
        }
        const planned = planTransit({ graph, departure, accessWalk, egressWalk });
        results[origin.id] = await finishTransit(graph, planned);
    }
    return { status: "ok", source: TRANSIT_SOURCE, mode: "transit", timezone: "America/Los_Angeles", results };
}
async function finishTransit(graph, planned) {
    if (planned.status !== "ok")
        return { ...planned, source: TRANSIT_SOURCE, timezone: "America/Los_Angeles", label: "Scheduled estimate" };
    let result = planned;
    if (result.transferFromId && result.transferToId && result.transferFromId !== result.transferToId) {
        const from = graph.stopById.get(result.transferFromId);
        const to = graph.stopById.get(result.transferToId);
        const walked = from && to ? await osrmRoute("foot", from, to) : { status: "provider_failure" };
        if (walked.status !== "ok") {
            return {
                status: "provider_failure",
                message: "The transfer walk could not be calculated from OpenStreetMap, so this transit result is unavailable.",
                source: TRANSIT_SOURCE,
            };
        }
        const deltaSeconds = walked.minutes * 60 - result.transferWalkSeconds;
        result = {
            ...result,
            minutes: result.minutes + Math.round(deltaSeconds / 60),
            transferWalkMinutes: walked.minutes,
            transferWalkSeconds: walked.minutes * 60,
        };
    }
    const lines = result.lines.join(", ") || "Transit";
    return {
        ...result,
        source: TRANSIT_SOURCE,
        timezone: "America/Los_Angeles",
        label: "Scheduled estimate",
        traffic: false,
        message: `${result.minutes} min scheduled transit via ${lines}. ${result.transfers} transfer${result.transfers === 1 ? "" : "s"}. Includes walking, waiting, riding, and transfers. Not live delays or fares. Departs ${result.departureTime}, arrives ${result.arrivalTime}.`,
    };
}
function candidates(graph, point) {
    return graph.stops
        .map((stop) => ({ stop, meters: distanceMeters(point, stop) }))
        .filter((item) => item.meters <= 2000)
        .sort((a, b) => a.meters - b.meters)
        .slice(0, 6)
        .map((item) => item.stop);
}
async function walkTable(anchor, stops, towardAnchor) {
    if (stops.length === 0)
        return {};
    const coords = [anchor, ...stops].map((point) => `${point.lon},${point.lat}`).join(";");
    const sources = towardAnchor ? stops.map((_, index) => index + 1).join(";") : "0";
    const destinations = towardAnchor ? "0" : stops.map((_, index) => index + 1).join(";");
    try {
        const response = await fetch(`${OSRM}/table/v1/foot/${coords}?sources=${sources}&destinations=${destinations}&annotations=duration`, {
            headers: { "User-Agent": userAgent() },
            signal: AbortSignal.timeout(20000),
        });
        if (response.ok) {
            const body = await response.json();
            const walks = {};
            stops.forEach((stop, index) => {
                const seconds = towardAnchor ? body.durations?.[index]?.[0] : body.durations?.[0]?.[index];
                if (Number.isFinite(seconds) && seconds <= 25 * 60)
                    walks[stop.id] = seconds;
            });
            if (Object.keys(walks).length)
                return walks;
        }
    }
    catch {
        // Individual routes below distinguish a total failure from an empty table.
    }
    const walks = {};
    for (const stop of stops) {
        const routed = await osrmRoute("foot", towardAnchor ? stop : anchor, towardAnchor ? anchor : stop);
        if (routed.status === "ok" && routed.minutes <= 25)
            walks[stop.id] = routed.minutes * 60;
    }
    return Object.keys(walks).length ? walks : null;
}
async function osrmRoute(profile, origin, destination) {
    try {
        const response = await fetch(`${OSRM}/route/v1/${profile}/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`, {
            headers: { "User-Agent": userAgent() },
            signal: AbortSignal.timeout(20000),
        });
        if (!response.ok)
            return { status: "provider_failure", message: "Routing failed. Retry to try again." };
        return interpretOsrm(await response.json());
    }
    catch {
        return { status: "provider_failure", message: "Routing failed. Retry to try again." };
    }
}
async function overpass(origin) {
    const data = `[out:json][timeout:25];(node["shop"~"^(supermarket|grocery|greengrocer)$"](around:1000,${origin.lat},${origin.lon});way["shop"~"^(supermarket|grocery|greengrocer)$"](around:1000,${origin.lat},${origin.lon});node["amenity"="pharmacy"](around:1000,${origin.lat},${origin.lon});way["amenity"="pharmacy"](around:1000,${origin.lat},${origin.lon});node["leisure"="park"](around:1000,${origin.lat},${origin.lon});way["leisure"="park"](around:1000,${origin.lat},${origin.lon});node["highway"="bus_stop"](around:1000,${origin.lat},${origin.lon});node["railway"~"^(station|halt|stop)$"](around:1000,${origin.lat},${origin.lon});node["public_transport"~"^(station|stop_position|platform)$"](around:1000,${origin.lat},${origin.lon});way["public_transport"~"^(station|platform)$"](around:1000,${origin.lat},${origin.lon});node["amenity"="bus_station"](around:1000,${origin.lat},${origin.lon}););out center;`;
    for (const endpoint of OVERPASS) {
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "User-Agent": userAgent(), "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ data }),
                signal: AbortSignal.timeout(30000),
            });
            if (!response.ok)
                continue;
            const body = await response.json();
            if (!Array.isArray(body.elements))
                continue;
            return { status: "ok", elements: body.elements };
        }
        catch {
            continue;
        }
    }
    return { status: "provider_failure" };
}
function missingLocation() {
    return { status: "missing_location", message: "This sample listing has no coordinates, so the result is unavailable." };
}
function unsupported() {
    return {
        status: "unsupported_coverage",
        message: "This place is outside initial VTA and Caltrain coverage.",
        source: TRANSIT_SOURCE,
        timezone: "America/Los_Angeles",
    };
}
function providerRoutes(origins, message) {
    return {
        status: "provider_failure",
        message,
        results: Object.fromEntries(origins.map((origin) => [origin.id, { status: "provider_failure", message, source: TRANSIT_SOURCE }])),
    };
}
async function mapPool(items, limit, task) {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            await task(item);
        }
    });
    await Promise.all(workers);
}
