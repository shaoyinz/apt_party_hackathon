import { useEffect, useState } from "react";
import { saleStatusCopy } from "./zillowCoverage.js";

export function SaleCache() {
    const [body, setBody] = useState(null);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState("all");
    useEffect(() => {
        let active = true;
        const query = filter === "all" ? "" : `?city=${encodeURIComponent(filter)}`;
        fetch(`/api/zillow-sales${query}`, { headers: { accept: "application/json" } })
            .then(async (response) => {
            const payload = await response.json();
            if (!active)
                return;
            setBody(payload);
            if (!response.ok && payload.state !== "database_unavailable")
                setError("The sale cache request failed.");
            else
                setError(null);
        })
            .catch(() => {
            if (active)
                setError("The sale cache did not respond. No sample sale listings are shown.");
        });
        return () => {
            active = false;
        };
    }, [filter]);
    const sources = body?.configured_sources || [];
    const listings = body?.listings || [];
    return (<section className="panel sale-panel" aria-labelledby="sale-heading">
      <h2 id="sale-heading">Zillow for-sale cache</h2>
      <p className="help">This section is not rental search. Prices are asking prices, not monthly rent, and are not used for affordability ranking. Opening or filtering this section only reads the cache.</p>
      <h3>Configured coverage</h3>
      {sources.length ? (<ul className="source-list">
          {sources.map((source) => (<li key={source.url}><strong>{source.label}</strong> <a href={source.url}>{source.url}</a></li>))}
        </ul>) : <p className="help">Configured coverage could not be loaded.</p>}
      <label>
        Filter cached rows by city or ZIP
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All configured searches</option>
          {sources.map((source) => <option key={source.url} value={source.label}>{source.label}</option>)}
        </select>
      </label>
      {!body && !error ? <p role="status">Loading the Zillow sale cache.</p> : null}
      {error ? <p className="warning" role="alert">{error}</p> : null}
      {body ? <p role="status">{saleStatusCopy(body)}{body.last_success_at ? ` Last success ${body.last_success_at}.` : ""}{body.latest_attempt?.outcome ? ` Latest outcome ${body.latest_attempt.outcome}.` : ""}{body.stale ? " Stale." : ""}</p> : null}
      {listings.length ? (<ul className="sale-list">
          {listings.map((listing) => (<li key={`${listing.search_url || ""}:${listing.source_identity || listing.listing_url}`}>
              <p><strong>{listing.city || "Configured search"}</strong></p>
              <p><strong>Asking price:</strong> {listing.pricing || "Unknown"}</p>
              <p>{listing.address || "Address unavailable"}</p>
              <p>{listing.size || "Size unavailable"}</p>
              {listing.listing_url ? <a href={listing.listing_url}>Source listing</a> : <p>No source link stored.</p>}
            </li>))}
        </ul>) : body && !error ? <p className="help">No cached sale rows for this filter. Sample fixtures are not shown here.</p> : null}
    </section>);
}
