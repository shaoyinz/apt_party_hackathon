import { amenityOrigins, geocodeQuery, routeOrigins } from "./location/handle.mjs";
const origin = { id: "sunnyvale-station", lat: 37.378934, lon: -122.0315 };
const destination = { lat: 37.395067, lon: -122.07722, label: "Mountain View Station" };
const report = {};
report.geocode = await geocodeQuery("Mountain View Caltrain");
report.driving = await routeOrigins({
    mode: "driving",
    destination,
    origins: [origin],
});
report.amenities = await amenityOrigins([origin]);
report.transit = await routeOrigins({
    mode: "transit",
    destination,
    departure: "2026-10-10T09:00",
    origins: [origin],
});
const transit = report.transit.results?.[origin.id];
const amenity = report.amenities.results?.[origin.id];
const driving = report.driving.results?.[origin.id];
const ok = report.geocode.status === "ok" &&
    driving?.status === "ok" &&
    driving.minutes > 0 &&
    amenity?.status === "ok" &&
    Number.isInteger(amenity.score) &&
    transit?.status === "ok" &&
    transit.minutes > 0 &&
    transit.timezone === "America/Los_Angeles" &&
    Array.isArray(transit.lines) &&
    transit.lines.length > 0;
console.log(JSON.stringify({
    ok,
    geocode: report.geocode.status,
    place: report.geocode.place?.label,
    drivingMinutes: driving?.minutes,
    drivingTraffic: driving?.traffic,
    convenience: amenity?.score,
    transitStatus: transit?.status,
    transitMinutes: transit?.minutes,
    lines: transit?.lines,
    transfers: transit?.transfers,
    departure: transit?.departureTime,
    arrival: transit?.arrivalTime,
    message: transit?.message,
}, null, 2));
if (!ok)
    process.exit(1);
