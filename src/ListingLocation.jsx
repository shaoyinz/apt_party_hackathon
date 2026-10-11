import { useEffect, useRef, useState } from "react";
import { saveListingLocation } from "./importApi";
import { postLocation } from "./location/api";
import { LISTING_GEOCODE_DISCLOSURE, confirmedLocationPayload, listingGeocodeQuery, originDisclosure } from "./location/listingGeo";

export function ListingLocationEditor({ address, city, onResolved }) {
    const query = listingGeocodeQuery(address, city);
    const [state, setState] = useState(idle(query));
    const token = useRef(0);
    const onResolvedRef = useRef(onResolved);
    onResolvedRef.current = onResolved;

    useEffect(() => {
        const id = token.current + 1;
        token.current = id;
        onResolvedRef.current(null);
        if (!query) {
            setState(idle(query));
            return undefined;
        }
        let cancelled = false;
        setState({ query, status: "loading", place: null, candidates: [], message: "", confirmed: null });
        postLocation("/api/location/geocode", { query, purpose: "listing" }).then((result) => {
            if (cancelled || token.current !== id)
                return;
            const next = fromResult(query, result);
            setState(next);
            onResolvedRef.current(next.confirmed);
        });
        return () => {
            cancelled = true;
        };
    }, [query]);

    function choose(place, approximate) {
        const confirmed = confirmedLocationPayload(query, {
            query,
            lat: place.lat,
            lon: place.lon,
            label: place.label,
            precision: place.precision,
        });
        if (approximate)
            confirmed.confirmedApproximate = true;
        setState((current) => ({ ...current, status: "confirmed", place, confirmed, message: approximate ? "Approximate origin confirmed. Estimates will use it and say so." : "Street match confirmed." }));
        onResolvedRef.current(confirmed);
    }

    function retry() {
        token.current += 1;
        const id = token.current;
        setState({ query, status: "loading", place: null, candidates: [], message: "", confirmed: null });
        onResolvedRef.current(null);
        postLocation("/api/location/geocode", { query, purpose: "listing" }).then((result) => {
            if (token.current !== id)
                return;
            const next = fromResult(query, result);
            setState(next);
            onResolvedRef.current(next.confirmed);
        });
    }

    return (<div className="metric" data-listing-location={state.status}>
      <h3>Resolved location</h3>
      <p className="help">{LISTING_GEOCODE_DISCLOSURE}</p>
      {state.status === "missing_address" ? <p role="status">Add an address or city to resolve a location. You can still save the listing.</p> : null}
      {state.status === "loading" ? <p role="status">Looking up this address…</p> : null}
      {state.message ? <p className={state.status === "provider_failure" || state.status === "not_found" ? "error" : "warning"} role="status">{state.message}</p> : null}
      {state.status === "confirmed" && state.place ? <p role="status">{originDisclosure(state.place, "user-provided")}</p> : null}
      {state.status === "ambiguous" ? (<div className="candidates">
        {state.candidates.map((candidate) => (<button key={`${candidate.lat},${candidate.lon}`} type="button" onClick={() => choose(candidate, candidate.precision !== "address")}>
          Use {candidate.label} ({candidate.precision === "address" ? "street" : candidate.precision})
        </button>))}
      </div>) : null}
      {state.status === "approximate" && state.place ? (<button type="button" onClick={() => choose(state.place, true)}>Use this approximate origin</button>) : null}
      {state.status === "provider_failure" || state.status === "not_found" ? (<button type="button" onClick={retry}>Retry geocoding</button>) : null}
    </div>);
}

export function SavedLocationList({ listings, onUpdated }) {
    if (!listings?.length)
        return null;
    return (<section className="panel" aria-labelledby="saved-location-heading">
      <h2 id="saved-location-heading">Resolve saved listing locations</h2>
      <p className="help">Correct an address and confirm a match without importing the listing again. A retry updates the same listing.</p>
      <ul>
        {listings.map((listing) => (<SavedLocationItem key={listing.id} listing={listing} onUpdated={onUpdated}/>))}
      </ul>
    </section>);
}

function SavedLocationItem({ listing, onUpdated }) {
    const [address, setAddress] = useState(listing.address || "");
    const [city, setCity] = useState(listing.city || "");
    const [payload, setPayload] = useState(null);
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    const query = listingGeocodeQuery(address, city);
    const changed = address.trim() !== (listing.address || "") || city.trim() !== (listing.city || "");

    async function save(event) {
        event.preventDefault();
        setBusy(true);
        setStatus("");
        try {
            const result = await saveListingLocation(listing.id, {
                address,
                city,
                location: confirmedLocationPayload(query, payload),
            });
            if (result.locationStatus === "provider_failure")
                setStatus(result.message || "Geocoding failed. The old location was cleared if the address changed. Retry to try again.");
            else
                setStatus("Location saved on this listing. Search again to refresh commute and convenience.");
            onUpdated(result.listings || []);
        }
        catch (error) {
            setStatus(error.message);
        }
        finally {
            setBusy(false);
        }
    }

    return (<li>
      <form onSubmit={save}>
        <p><strong>{listing.title}</strong></p>
        <p role="status">{listing.coordinates ? originDisclosure(listing.coordinates, listing.origin) : "No confirmed location. Commute and convenience stay unavailable."}</p>
        <label className="field">Address
          <input value={address} onChange={(event) => setAddress(event.target.value)}/>
        </label>
        <label className="field">City
          <input value={city} onChange={(event) => setCity(event.target.value)}/>
        </label>
        <ListingLocationEditor address={address} city={city} onResolved={setPayload}/>
        {changed && !payload ? <p className="warning" role="status">The old location is not reused after this address change.</p> : null}
        {status ? <p role="status">{status}</p> : null}
        <button className="primary" type="submit" disabled={busy}>Save location</button>
      </form>
    </li>);
}

function idle(query) {
    return {
        query,
        status: query ? "loading" : "missing_address",
        place: null,
        candidates: [],
        message: query ? "" : "Add an address or city to resolve a location. You can still save the listing.",
        confirmed: null,
    };
}

function fromResult(query, result) {
    if (result?.status === "ok" && result.place?.precision === "address") {
        return {
            query,
            status: "confirmed",
            place: result.place,
            candidates: [],
            message: "Street match found. It will be saved with this listing unless you change the address.",
            confirmed: confirmedLocationPayload(query, { ...result.place, query }),
        };
    }
    if (result?.status === "approximate") {
        return {
            query,
            status: "approximate",
            place: result.place,
            candidates: [],
            message: result.message,
            confirmed: null,
        };
    }
    if (result?.status === "ambiguous") {
        return {
            query,
            status: "ambiguous",
            place: null,
            candidates: result.candidates || [],
            message: result.message || "Choose one match.",
            confirmed: null,
        };
    }
    if (result?.status === "provider_failure") {
        return {
            query,
            status: "provider_failure",
            place: null,
            candidates: [],
            message: result.message || "Geocoding failed. Retry to try again. You can still save the listing.",
            confirmed: null,
        };
    }
    return {
        query,
        status: "not_found",
        place: null,
        candidates: [],
        message: result?.message || "No matching place. Correct the address and city, then try again.",
        confirmed: null,
    };
}
