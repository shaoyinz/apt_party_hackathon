import { useEffect, useMemo, useRef, useState } from "react";
import { postLocation } from "./location/api";
import { commuteSignature, createRequestGate, rankingMetrics } from "./location/requests";
import { parsePacificLocal } from "./location/time";
function missingMessage(listing) {
    if (listing.origin === "user-provided")
        return "This saved listing has no confirmed location, so commute and convenience are unavailable.";
    return "This listing has no coordinates, so the result is unavailable.";
}
export function useLocationMetrics(state, setState, active, listings) {
    const gate = useRef(createRequestGate());
    const [geocode, setGeocode] = useState({ status: "idle", place: null, candidates: [], message: "" });
    const [commute, setCommute] = useState({ signature: "", status: "idle", byId: {}, source: "" });
    const [amenities, setAmenities] = useState({ status: "idle", byId: {}, source: "" });
    const [retry, setRetry] = useState(0);
    const signature = commuteSignature(state);
    const origins = useMemo(() => listings.filter((listing) => Number.isFinite(listing.coordinates?.lat) && Number.isFinite(listing.coordinates?.lon)).map((listing) => ({
        id: listing.id,
        lat: listing.coordinates.lat,
        lon: listing.coordinates.lon,
    })), [listings]);
    useEffect(() => {
        if (!active)
            return undefined;
        const id = gate.current.next("amenities");
        let cancelled = false;
        setAmenities({ status: "loading", byId: {}, source: "" });
        postLocation("/api/location/amenities", { origins }).then((result) => {
            if (cancelled || !gate.current.isCurrent("amenities", id))
                return;
            const byId = { ...(result.results ?? {}) };
            for (const listing of listings) {
                if (!hasCoordinates(listing))
                    byId[listing.id] = { status: "missing_location", message: missingMessage(listing) };
                else if (!byId[listing.id])
                    byId[listing.id] = { status: "provider_failure", message: result.message || "Amenity data is unavailable. This is not a zero score." };
            }
            setAmenities({ status: result.status === "provider_failure" ? "provider_failure" : "ready", byId, source: result.source ?? "" });
        });
        return () => {
            cancelled = true;
        };
    }, [active, listings, origins, retry]);
    useEffect(() => {
        if (!active)
            return undefined;
        const query = state.destination.trim();
        if (!query) {
            setGeocode({ status: "not_found", place: null, candidates: [], message: "Enter a destination to calculate commute time." });
            setCommute({ signature, status: "not_found", byId: missingRoutes(listings, "Enter a destination to calculate commute time."), source: "" });
            return undefined;
        }
        const confirmed = state.confirmedDestination?.query === query ? state.confirmedDestination.place : null;
        if (!confirmed) {
            const id = gate.current.next("geocode");
            let cancelled = false;
            setGeocode({ status: "loading", place: null, candidates: [], message: "" });
            setCommute({ signature, status: "loading", byId: {}, source: "" });
            postLocation("/api/location/geocode", { query }).then((result) => {
                if (cancelled || !gate.current.isCurrent("geocode", id))
                    return;
                setGeocode({
                    status: result.status,
                    place: result.place ?? null,
                    candidates: result.candidates ?? [],
                    message: result.message ?? "",
                });
                if (result.status === "ok" && result.place) {
                    setState((current) => current.destination.trim() === query
                        ? { ...current, confirmedDestination: { query, place: result.place } }
                        : current);
                }
            });
            return () => {
                cancelled = true;
            };
        }
        if (state.travelMode === "transit" && !parsePacificLocal(state.transitDeparture).ok) {
            setGeocode({ status: "ok", place: confirmed, candidates: [], message: "" });
            setCommute({
                signature,
                status: "invalid_departure",
                byId: missingRoutes(listings, "Enter a valid departure date and time. Times use America/Los_Angeles.", "invalid_departure"),
                source: "",
            });
            return undefined;
        }
        const id = gate.current.next("commute");
        let cancelled = false;
        setGeocode({ status: "ok", place: confirmed, candidates: [], message: "" });
        setCommute({ signature, status: "loading", byId: {}, source: "" });
        postLocation("/api/location/routes", {
            mode: state.travelMode,
            departure: state.transitDeparture,
            destination: confirmed,
            origins,
        }).then((result) => {
            if (cancelled || !gate.current.isCurrent("commute", id))
                return;
            const byId = { ...(result.results ?? {}) };
            for (const listing of listings) {
                if (!hasCoordinates(listing))
                    byId[listing.id] = { status: "missing_location", message: missingMessage(listing) };
                else if (!byId[listing.id])
                    byId[listing.id] = { status: result.status || "provider_failure", message: result.message || "The location service failed. Retry to try again." };
            }
            setCommute({ signature, status: "ready", byId, source: result.source ?? "" });
        });
        return () => {
            cancelled = true;
        };
    }, [active, listings, origins, retry, setState, signature, state.confirmedDestination, state.destination, state.transitDeparture, state.travelMode]);
    const metricsById = useMemo(() => rankingMetrics(listings, commute, amenities, signature), [amenities, commute, listings, signature]);
    return {
        geocode,
        commute,
        amenities,
        metricsById,
        signature,
        retryAll() {
            setRetry((value) => value + 1);
        },
        choosePlace(place) {
            const query = state.destination.trim();
            setState((current) => ({ ...current, confirmedDestination: { query, place } }));
        },
    };
}
function hasCoordinates(listing) {
    return Number.isFinite(listing.coordinates?.lat) && Number.isFinite(listing.coordinates?.lon);
}
function missingRoutes(listings, message, status = "not_found") {
    return Object.fromEntries(listings.map((listing) => [
        listing.id,
        hasCoordinates(listing)
            ? { status, message }
            : { status: "missing_location", message: missingMessage(listing) },
    ]));
}
