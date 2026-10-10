export function createRequestGate() {
    const current = { geocode: 0, commute: 0, amenities: 0 };
    return {
        next(channel) {
            current[channel] += 1;
            return current[channel];
        },
        isCurrent(channel, id) {
            return current[channel] === id;
        },
    };
}
export function commuteSignature(state) {
    const query = state.destination.trim();
    const confirmed = state.confirmedDestination?.query === query ? state.confirmedDestination.place : null;
    return JSON.stringify({
        destination: query,
        mode: state.travelMode,
        departure: state.travelMode === "transit" ? state.transitDeparture : "",
        lat: confirmed?.lat ?? null,
        lon: confirmed?.lon ?? null,
    });
}
export function rankingMetrics(listings, commute, amenities, signature) {
    const metricsById = {};
    for (const listing of listings) {
        const amenity = amenities.byId[listing.id];
        const route = commute.signature === signature ? commute.byId[listing.id] : null;
        metricsById[listing.id] = {
            commuteStatus: route?.status ?? "unavailable",
            commuteMinutes: route?.status === "ok" ? route.minutes : null,
            convenienceStatus: amenity?.status ?? "unavailable",
            convenienceScore: amenity?.status === "ok" ? amenity.score : null,
        };
    }
    return metricsById;
}
