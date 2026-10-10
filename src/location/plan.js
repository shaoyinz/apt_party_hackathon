import { distanceMeters } from "./geo.js";
import { formatPacificClock, journeyMinutes } from "./time.js";
const TRANSFER_BUFFER_SEC = 120;
const DIRECT_WINDOW_SEC = 8 * 3600;
const TRANSFER_WINDOW_SEC = 4 * 3600;
export function planTransit({ graph, departure, accessWalk, egressWalk }) {
    if (!departure?.ok)
        return { status: "invalid_departure", message: "Enter a valid departure date and time. Times use America/Los_Angeles." };
    if (!graph.feeds.some((feed) => departure.gtfsDate >= feed.start && departure.gtfsDate <= feed.end)) {
        return {
            status: "expired_schedule",
            message: "The published VTA and Caltrain schedules do not cover this departure date.",
        };
    }
    const services = graph.servicesOn(departure.gtfsDate);
    const destIds = expandIds(graph, Object.keys(egressWalk));
    const originIds = expandIds(graph, Object.keys(accessWalk));
    if (originIds.size === 0 || destIds.size === 0 || services.size === 0) {
        return { status: "no_service", message: noServiceMessage() };
    }
    const onward = buildOnward(graph, destIds, services, egressWalk);
    let best = null;
    for (const originId of Object.keys(accessWalk)) {
        const ready = departure.seconds + accessWalk[originId];
        for (const stopId of expandIds(graph, [originId])) {
            const departures = graph.departuresByStop.get(stopId) ?? [];
            const start = firstAtOrAfter(departures, ready);
            for (let index = start; index < departures.length; index += 1) {
                const boarding = departures[index];
                if (boarding.dep > ready + DIRECT_WINDOW_SEC)
                    break;
                if (!services.has(boarding.serviceId))
                    continue;
                const trip = graph.trips.get(boarding.tripId);
                if (!trip)
                    continue;
                const direct = directItinerary(graph, trip, boarding, destIds, egressWalk, departure, accessWalk[originId], originId);
                if (direct)
                    best = prefer(best, direct);
                if (boarding.dep > ready + TRANSFER_WINDOW_SEC)
                    continue;
                const transferred = transferItinerary(graph, trip, boarding, onward, departure, accessWalk[originId], originId, services);
                if (transferred)
                    best = prefer(best, transferred);
            }
        }
    }
    if (!best)
        return { status: "no_service", message: noServiceMessage() };
    return { status: "ok", ...best, timezone: "America/Los_Angeles" };
}
export function nearestStopMeters(stops, point) {
    let best = Infinity;
    for (const stop of stops) {
        if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon))
            continue;
        best = Math.min(best, distanceMeters(point, stop));
    }
    return best;
}
function noServiceMessage() {
    return "No scheduled VTA or Caltrain journey with at most one transfer was found for this departure.";
}
function expandIds(graph, ids) {
    const expanded = new Set();
    for (const id of ids) {
        expanded.add(id);
        const stop = graph.stopById.get(id);
        if (stop?.parentId) {
            expanded.add(stop.parentId);
            for (const child of graph.children.get(stop.parentId) ?? [])
                expanded.add(child);
        }
        for (const child of graph.children.get(id) ?? [])
            expanded.add(child);
    }
    return expanded;
}
function buildOnward(graph, destIds, services, egressWalk) {
    const onward = new Map();
    for (const [tripId, trip] of graph.trips) {
        if (!services.has(trip.serviceId))
            continue;
        let destEvent = null;
        let destStopId = null;
        for (let index = trip.stops.length - 1; index >= 0; index -= 1) {
            const event = trip.stops[index];
            if (destIds.has(event.stopId) && event.dropOff !== "1") {
                destEvent = event;
                destStopId = event.stopId;
                continue;
            }
            if (!destEvent || event.pickup === "1")
                continue;
            const egress = egressSeconds(graph, destStopId, egressWalk);
            if (egress == null)
                continue;
            pushOnward(onward, event.stopId, {
                tripId,
                dep: event.dep,
                destArr: destEvent.arr,
                destStopId,
                routeName: trip.routeName,
                egress,
                serviceId: trip.serviceId,
            });
        }
    }
    for (const list of onward.values())
        list.sort((a, b) => a.dep - b.dep || a.destArr - b.destArr);
    return onward;
}
function pushOnward(onward, stopId, item) {
    let list = onward.get(stopId);
    if (!list)
        onward.set(stopId, (list = []));
    list.push(item);
}
function egressSeconds(graph, stopId, egressWalk) {
    if (egressWalk[stopId] != null)
        return egressWalk[stopId];
    const stop = graph.stopById.get(stopId);
    if (stop?.parentId && egressWalk[stop.parentId] != null)
        return egressWalk[stop.parentId];
    for (const [id, seconds] of Object.entries(egressWalk)) {
        if (expandIds(graph, [id]).has(stopId))
            return seconds;
    }
    return null;
}
function directItinerary(graph, trip, boarding, destIds, egressWalk, departure, accessSeconds, originStopId) {
    const events = trip.stops;
    for (let index = boarding.index + 1; index < events.length; index += 1) {
        const event = events[index];
        if (!destIds.has(event.stopId) || event.dropOff === "1")
            continue;
        const egress = egressSeconds(graph, event.stopId, egressWalk);
        if (egress == null)
            return null;
        const arrivalSec = event.arr + egress;
        return describe({
            departure,
            accessSeconds,
            originStopId,
            egressSeconds: egress,
            arrivalSec,
            transfers: 0,
            transferWalkSeconds: 0,
            lines: [trip.routeName],
            firstBoard: boarding.dep,
            rideSeconds: event.arr - boarding.dep,
            graph,
            destStopId: event.stopId,
        });
    }
    return null;
}
function transferItinerary(graph, trip, boarding, onward, departure, accessSeconds, originStopId, services) {
    let best = null;
    for (let index = boarding.index + 1; index < trip.stops.length; index += 1) {
        const alight = trip.stops[index];
        if (alight.dropOff === "1")
            continue;
        for (const target of graph.neighbors.get(alight.stopId) ?? [{ id: alight.stopId, walkSeconds: 0 }]) {
            const list = onward.get(target.id);
            if (!list)
                continue;
                const boardAfter = alight.arr + Math.max(TRANSFER_BUFFER_SEC, target.walkSeconds);
                const start = firstAtOrAfter(list, boardAfter);
                for (let cursor = start; cursor < Math.min(list.length, start + 6); cursor += 1) {
                    const next = list[cursor];
                    if (next.tripId === boarding.tripId || !services.has(next.serviceId))
                        continue;
                    const arrivalSec = next.destArr + next.egress;
                    const candidate = describe({
                        departure,
                        accessSeconds,
                        originStopId,
                        egressSeconds: next.egress,
                        arrivalSec,
                        transfers: 1,
                        transferWalkSeconds: target.walkSeconds,
                        transferFromId: alight.stopId,
                        transferToId: target.id,
                        extraWaitSeconds: Math.max(0, next.dep - (alight.arr + target.walkSeconds)),
                        lines: [trip.routeName, next.routeName],
                        firstBoard: boarding.dep,
                        rideSeconds: alight.arr - boarding.dep + (next.destArr - next.dep),
                        graph,
                        destStopId: next.destStopId,
                    });
                    best = prefer(best, candidate);
                }
        }
    }
    return best;
}
function describe(input) {
    const total = journeyMinutes(input.departure.seconds, input.arrivalSec);
    if (!Number.isFinite(total) || total < 0)
        return null;
    const waitSeconds = Math.max(0, input.firstBoard - (input.departure.seconds + input.accessSeconds)) + (input.extraWaitSeconds ?? 0);
    return {
        minutes: total,
        transfers: input.transfers,
        transferFromId: input.transferFromId ?? null,
        transferToId: input.transferToId ?? null,
        lines: [...new Set(input.lines.filter(Boolean))],
        departureTime: formatPacificClock(input.departure.ymd, input.firstBoard),
        arrivalTime: formatPacificClock(input.departure.ymd, input.arrivalSec),
        accessMinutes: Math.round(input.accessSeconds / 60),
        waitMinutes: Math.round(waitSeconds / 60),
        rideMinutes: Math.round(Math.max(0, input.rideSeconds) / 60),
        transferWalkMinutes: Math.round(input.transferWalkSeconds / 60),
        egressMinutes: Math.round(input.egressSeconds / 60),
        arrivalSec: input.arrivalSec,
        transferWalkSeconds: input.transferWalkSeconds,
        label: "Scheduled estimate",
    };
}
function prefer(current, next) {
    if (!next)
        return current;
    if (!current)
        return next;
    if (next.arrivalSec !== current.arrivalSec)
        return next.arrivalSec < current.arrivalSec ? next : current;
    return next.transfers < current.transfers ? next : current;
}
function firstAtOrAfter(list, dep) {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].dep < dep)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
}
