import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { distanceMeters } from "../../src/location/geo.js";
import { servicesForDate } from "../../src/location/time.js";
import { parseCsv } from "./csv.mjs";
const FEEDS = [
    {
        id: "caltrain",
        name: "Caltrain",
        url: process.env.CALTRAIN_GTFS_URL || "https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip",
        file: "caltrain.zip",
    },
    {
        id: "vta",
        name: "VTA",
        url: process.env.VTA_GTFS_URL || "https://gtfs.vta.org/gtfs_vta.zip",
        file: "vta.zip",
    },
];
let pending = null;
export function getTransitGraph() {
    if (!pending) {
        pending = loadGraph().catch((error) => {
            pending = null;
            throw error;
        });
    }
    return pending;
}
async function loadGraph() {
    const cache = process.env.GTFS_CACHE_DIR || path.join(process.cwd(), ".cache", "gtfs");
    mkdirSync(cache, { recursive: true });
    const feeds = [];
    const stops = [];
    const trips = new Map();
    const departuresByStop = new Map();
    const children = new Map();
    const calendar = [];
    const calendarDates = [];
    for (const feed of FEEDS) {
        const zipPath = path.join(cache, feed.file);
        if (!existsSync(zipPath))
            await download(feed.url, zipPath);
        const info = rows(zipPath, "feed_info.txt")[0] ?? {};
        feeds.push({
            id: feed.id,
            name: feed.name,
            start: info.feed_start_date || "00000000",
            end: info.feed_end_date || "99999999",
        });
        const routeNames = new Map();
        for (const row of rows(zipPath, "routes.txt")) {
            routeNames.set(row.route_id, row.route_short_name || row.route_long_name || "Transit");
        }
        for (const row of rows(zipPath, "stops.txt")) {
            const lat = Number(row.stop_lat);
            const lon = Number(row.stop_lon);
            if (!row.stop_id || !Number.isFinite(lat) || !Number.isFinite(lon))
                continue;
            const stopId = `${feed.id}:${row.stop_id}`;
            stops.push({
                id: stopId,
                name: row.stop_name || row.stop_id,
                lat,
                lon,
                parentId: row.parent_station ? `${feed.id}:${row.parent_station}` : null,
            });
            if (row.parent_station) {
                const parentId = `${feed.id}:${row.parent_station}`;
                const list = children.get(parentId) ?? [];
                list.push(stopId);
                children.set(parentId, list);
            }
        }
        for (const row of rows(zipPath, "calendar.txt")) {
            calendar.push({
                serviceId: `${feed.id}:${row.service_id}`,
                start: row.start_date,
                end: row.end_date,
                monday: row.monday,
                tuesday: row.tuesday,
                wednesday: row.wednesday,
                thursday: row.thursday,
                friday: row.friday,
                saturday: row.saturday,
                sunday: row.sunday,
            });
        }
        for (const row of rows(zipPath, "calendar_dates.txt")) {
            calendarDates.push({ serviceId: `${feed.id}:${row.service_id}`, date: row.date, exceptionType: row.exception_type });
        }
        const feedTrips = new Map();
        for (const row of rows(zipPath, "trips.txt")) {
            feedTrips.set(row.trip_id, {
                routeName: routeNames.get(row.route_id) || "Transit",
                serviceId: `${feed.id}:${row.service_id}`,
                feedId: feed.id,
                stops: [],
            });
        }
        for (const row of rows(zipPath, "stop_times.txt")) {
            const trip = feedTrips.get(row.trip_id);
            if (!trip || !row.arrival_time || !row.departure_time)
                continue;
            trip.stops.push({
                stopId: `${feed.id}:${row.stop_id}`,
                arr: timeToSec(row.arrival_time),
                dep: timeToSec(row.departure_time),
                seq: Number(row.stop_sequence),
                pickup: row.pickup_type,
                dropOff: row.drop_off_type,
            });
        }
        for (const [tripId, trip] of feedTrips) {
            trip.stops.sort((a, b) => a.seq - b.seq);
            trips.set(`${feed.id}:${tripId}`, trip);
            trip.stops.forEach((stop, index) => {
                const list = departuresByStop.get(stop.stopId) ?? [];
                list.push({ tripId: `${feed.id}:${tripId}`, index, dep: stop.dep, serviceId: trip.serviceId });
                departuresByStop.set(stop.stopId, list);
            });
        }
    }
    for (const list of departuresByStop.values())
        list.sort((a, b) => a.dep - b.dep);
    const stopById = new Map(stops.map((stop) => [stop.id, stop]));
    return {
        feeds,
        stops,
        stopById,
        children,
        trips,
        departuresByStop,
        neighbors: buildNeighbors(stops, children),
        servicesOn(gtfsDate) {
            const ymd = `${gtfsDate.slice(0, 4)}-${gtfsDate.slice(4, 6)}-${gtfsDate.slice(6, 8)}`;
            return servicesForDate(calendar, calendarDates, ymd);
        },
    };
}
function rows(zipPath, name) {
    try {
        return parseCsv(execFileSync("unzip", ["-p", zipPath, name], { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 }));
    }
    catch {
        return [];
    }
}
function timeToSec(value) {
    const [hour, minute, second] = value.split(":").map(Number);
    return hour * 3600 + minute * 60 + (second || 0);
}
function buildNeighbors(stops, children) {
    const cell = 0.004;
    const buckets = new Map();
    for (const stop of stops) {
        const key = `${Math.floor(stop.lat / cell)}:${Math.floor(stop.lon / cell)}`;
        const list = buckets.get(key) ?? [];
        list.push(stop);
        buckets.set(key, list);
    }
    const neighbors = new Map();
    for (const stop of stops) {
        const found = new Map([[stop.id, 0]]);
        if (stop.parentId)
            found.set(stop.parentId, 0);
        for (const child of children.get(stop.id) ?? [])
            found.set(child, 0);
        const latCell = Math.floor(stop.lat / cell);
        const lonCell = Math.floor(stop.lon / cell);
        for (let dLat = -1; dLat <= 1; dLat += 1) {
            for (let dLon = -1; dLon <= 1; dLon += 1) {
                for (const other of buckets.get(`${latCell + dLat}:${lonCell + dLon}`) ?? []) {
                    if (other.id === stop.id)
                        continue;
                    const meters = distanceMeters(stop, other);
                    if (meters <= 400)
                        found.set(other.id, Math.round(meters / 1.25));
                }
            }
        }
        const list = [...found.entries()]
            .map(([id, walkSeconds]) => ({ id, walkSeconds }))
            .sort((a, b) => a.walkSeconds - b.walkSeconds)
            .slice(0, 8);
        neighbors.set(stop.id, list);
    }
    return neighbors;
}
async function download(url, destination) {
    const response = await fetch(url, { headers: { "User-Agent": userAgent() } });
    if (!response.ok)
        throw new Error(`Could not download ${url} (${response.status})`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}
export function userAgent() {
    return "RoostPrototype/0.1 (local housing prototype)";
}
