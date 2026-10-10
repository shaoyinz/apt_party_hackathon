
import { useEffect, useMemo, useState } from "react";
import { LISTINGS as FALLBACK_LISTINGS } from "./fixtures";
import { fetchDemoListings } from "./lib/listings";
import { buildExport } from "./feedback";
import { rankListings } from "./matching";
import { AREA_SUGGESTIONS, DEMO_COMMUTE_DESTINATION, LEASE_FLEX_MAX_MONTHS, PRIORITY_IDS, PRIORITY_LABELS, emptyState, formatMoney, leaseFact, listingOrigin, offerKindLabel, parseBudget, rentFact, validateSearch, yesNoUnknown } from "./model";
import { clearState, loadState, probeBrowserStore, saveState } from "./storage";
const store = probeBrowserStore();
export function App() {
    const initial = loadState(store);
    const [state, setState] = useState(initial.state);
    const [warning, setWarning] = useState(initial.warning);
    const [errors, setErrors] = useState({});
    const [submitted, setSubmitted] = useState(false);
    const [catalog, setCatalog] = useState(null);
    const [catalogError, setCatalogError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [demoListings, setDemoListings] = useState(FALLBACK_LISTINGS);
    const [dataStatus, setDataStatus] = useState("loading");
    
    useEffect(() => {
        const next = saveState(store, state);
        if (next)
            setWarning(next);
    }, [state]);
    useEffect(() => {
        let cancelled = false;
        void loadCatalog().then((next) => {
            if (!cancelled)
                setCatalog(next);
        }).catch(() => {
            if (!cancelled)
                setCatalogError("The listing import service did not respond. Sample fixtures are not live results.");
        });
        return () => {
            cancelled = true;
        };
    }, []);
   useEffect(() => {
    let active = true;

    fetchDemoListings()
        .then((rows) => {
            if (!active) return;

            if (rows.length > 0) {
                setDemoListings(rows);
                setDataStatus("database");
            } else {
                setDataStatus("fallback");
            }
        })
        .catch((error) => {
            console.error("Supabase listings unavailable:", error);

            if (active) {
                setDataStatus("fallback");
            }
        });

    return () => {
        active = false;
    };
   }, []);
 
    const parsedBudget = parseBudget(state.budgetText);

    const budget = parsedBudget.ok ? parsedBudget.budget : null;

    const imported = catalog?.listings ?? [];

    const listings = useMemo(
      () => [...demoListings, ...imported],
      [demoListings, imported]
    );

    const outcome = useMemo(() => rankListings(listings, state.area, budget, state.priorities, state.mode), [listings, state.area, budget, state.priorities, state.mode]);
    const matchingIds = useMemo(() => new Set(outcome.eligible.map((item) => item.listing.id)), [outcome]);
    const titles = useMemo(() => new Map(listings.map((listing) => [listing.id, listing.title])), [listings]);
    const exported = useMemo(() => buildExport(state, titles, matchingIds, {
        listings,
        liveImport: {
            status: catalogError ? "unavailable" : catalog ? catalogStatus(catalog) : "loading",
            importedAt: catalog?.importedAt ?? null,
            errorCode: catalog?.errorCode ?? (catalogError ? "unavailable" : null),
        },
    }), [state, titles, matchingIds, listings, catalog, catalogError]);
    const outside = state.useful.filter((item) => !matchingIds.has(item.id));
    function update(patch) {
        setState((current) => ({ ...current, ...patch }));
    }
    function onSubmit(event) {
        event.preventDefault();
        setSubmitted(true);
        const nextErrors = validateSearch(state);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0)
            return;
        update({ view: "results" });
    }
    function movePriority(index, direction) {
        const next = [...state.priorities];
        const target = index + direction;
        if (target < 0 || target >= next.length)
            return;
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item);
        update({ priorities: next });
    }
    function toggleUseful(id) {
        const existing = state.useful.some((item) => item.id === id);
        update({
            useful: existing
                ? state.useful.filter((item) => item.id !== id)
                : [...state.useful, { id, note: "" }],
        });
    }
    function setNote(id, note) {
        update({
            useful: state.useful.map((item) => (item.id === id ? { ...item, note } : item)),
        });
    }
    async function refreshImport() {
        setRefreshing(true);
        setCatalogError(null);
        try {
            setCatalog(await loadCatalog(true));
        }
        catch {
            setCatalogError("Refresh failed before a catalog response. Saved listings were not replaced with sample data.");
        }
        finally {
            setRefreshing(false);
        }
    }
    function reset() {
        if (!window.confirm("Reset this browser's saved search, useful listings, and feedback?"))
            return;
        const nextWarning = clearState(store);
        setState(emptyState());
        setErrors({});
        setSubmitted(false);
        setWarning(nextWarning);
    }
    return (<div className="page">
      <header className="mast">
        <p className="stamp">{catalog && imported.length > 0 ? "Imported + sample" : "Sample data"}</p>
        <div>
          <p className="eyebrow">South Bay scratch prototype</p>
          <h1>Roost</h1>
        </div>
      </header>
      <p className="local-note" role="status">
         {dataStatus === "database"
         ? "Displaying synthetic sample listings loaded from Supabase."
          : dataStatus === "loading"
            ? "Loading Supabase demo listings."
            : "Supabase unavailable; using local sample fixtures."}
      </p>
      <p className="banner" role="note">
        {importBanner(catalog, catalogError, refreshing)} Roost does not calculate your route, verify
        reviews, or make an AI recommendation. Nothing is sent to the team unless you share an export
        yourself.
      </p>
      <ImportPanel catalog={catalog} catalogError={catalogError} refreshing={refreshing} onRefresh={() => void refreshImport()}/>
      {warning ? (<p className="warning" role="status">
          {warning} Saved data stays in this browser only.
        </p>) : (<p className="local-note">Search, shortlist, and feedback stay in this browser only.</p>)}

      {state.view === "setup" ? (<SearchForm state={state} errors={submitted ? errors : {}} onArea={(area) => update({ area })} onMode={(mode) => update({ mode })} onHousehold={(householdSize) => update({ householdSize })} onBudget={(budgetText) => update({ budgetText })} onAdd={(id) => update({ priorities: [...state.priorities, id] })} onRemove={(id) => update({ priorities: state.priorities.filter((item) => item !== id) })} onMove={movePriority} onSubmit={onSubmit}/>) : (<Results state={state} outcomeEligible={outcome.eligible} areaKnown={outcome.areaKnown} excludedUnknownRent={outcome.excludedUnknownRent} excludedInapplicableRent={outcome.excludedInapplicableRent} budget={budget} outside={outside} titles={titles} listings={listings} catalog={catalog} catalogError={catalogError} onEdit={() => update({ view: "setup" })} onToggle={toggleUseful} onNote={setNote} onReset={reset}/>)}

      <FeedbackPanel state={state} exported={exported} onFeedback={(generalFeedback) => update({ generalFeedback })} onReset={reset} showReset={state.view === "setup"}/>
    </div>);
}
function SearchForm({ state, errors, onArea, onMode, onHousehold, onBudget, onAdd, onRemove, onMove, onSubmit, }) {
    const available = PRIORITY_IDS.filter((id) => !state.priorities.includes(id));
    return (<form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Describe your search</h2>
      <div className="field">
        <label htmlFor="area">Ideal city or neighborhood</label>
        <input id="area" name="area" list="area-suggestions" value={state.area} onChange={(event) => onArea(event.target.value)} aria-invalid={errors.area ? true : undefined} aria-describedby="area-help area-error" autoComplete="off"/>
        <datalist id="area-suggestions">
          {AREA_SUGGESTIONS.map((suggestion) => (<option key={suggestion} value={suggestion}/>))}
        </datalist>
        <p id="area-help" className="help">
          Sample areas: {AREA_SUGGESTIONS.join(", ")}.
        </p>
        {errors.area ? (<p id="area-error" className="error" role="alert">
            {errors.area}
          </p>) : null}
      </div>

      <fieldset>
        <legend>Who is hunting?</legend>
        <label className="choice">
          <input type="radio" name="mode" checked={state.mode === "solo"} onChange={() => onMode("solo")}/>
          Solo
        </label>
        <label className="choice">
          <input type="radio" name="mode" checked={state.mode === "roommates"} onChange={() => onMode("roommates")}/>
          With roommates
        </label>
        <p className="help">Roommate mode records household size only. It does not invite anyone.</p>
      </fieldset>

      {state.mode === "roommates" ? (<div className="field">
          <label htmlFor="household">Household size</label>
          <select id="household" value={state.householdSize ?? ""} onChange={(event) => onHousehold(event.target.value ? Number(event.target.value) : null)} aria-invalid={errors.household ? true : undefined} aria-describedby={errors.household ? "household-error" : undefined}>
            <option value="">Choose 2, 3, or 4</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
          {errors.household ? (<p id="household-error" className="error" role="alert">
              {errors.household}
            </p>) : null}
        </div>) : null}

      <div className="field">
        <label htmlFor="budget">Total monthly budget (optional)</label>
        <input id="budget" name="budget" inputMode="decimal" value={state.budgetText} onChange={(event) => onBudget(event.target.value)} aria-invalid={errors.budget ? true : undefined} aria-describedby="budget-help budget-error" placeholder="Leave blank for no ceiling"/>
        <p id="budget-help" className="help">
          Total monthly listing rent in USD, not rent per person.
        </p>
        {errors.budget ? (<p id="budget-error" className="error" role="alert">
            {errors.budget}
          </p>) : null}
      </div>

      <fieldset>
        <legend>What matters most?</legend>
        <p className="help" id="priority-help">
          Select one or more, then arrange them from most important to least. Commute uses sample
          minutes to {DEMO_COMMUTE_DESTINATION}, a fixed demo destination. Your real route is not
          calculated. Lease flexibility means a listed term of {LEASE_FLEX_MAX_MONTHS} months or less.
        </p>
        <div className="add-row" aria-label="Available priorities">
          {available.map((id) => (<button key={id} type="button" onClick={() => onAdd(id)}>
              Add {PRIORITY_LABELS[id]}
            </button>))}
        </div>
        {state.priorities.length === 0 ? (<p className="help">No priorities selected yet.</p>) : (<ol className="priority-order">
            {state.priorities.map((id, index) => (<li key={id}>
                <span className="rank" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="priority-name">
                  {PRIORITY_LABELS[id]}
                  <span className="sr-only">, priority {index + 1} of {state.priorities.length}</span>
                </span>
                <span className="priority-actions">
                  <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} aria-label={`Move ${PRIORITY_LABELS[id]} up`}>
                    Up
                  </button>
                  <button type="button" onClick={() => onMove(index, 1)} disabled={index === state.priorities.length - 1} aria-label={`Move ${PRIORITY_LABELS[id]} down`}>
                    Down
                  </button>
                  <button type="button" onClick={() => onRemove(id)} aria-label={`Remove ${PRIORITY_LABELS[id]}`}>
                    Remove
                  </button>
                </span>
              </li>))}
          </ol>)}
        {errors.priorities ? (<p className="error" role="alert">
            {errors.priorities}
          </p>) : null}
      </fieldset>

      <button className="primary" type="submit">
        View matches
      </button>
    </form>);
}
function Results({ state, outcomeEligible, areaKnown, excludedUnknownRent, excludedInapplicableRent, budget, outside, titles, listings, catalog, catalogError, onEdit, onToggle, onNote, onReset, }) {
    const parsed = parseBudget(state.budgetText);
    const unlocated = listings.filter((listing) => listingOrigin(listing) === "imported" && !listing.city && !listing.neighborhood);
    const liveFailed = Boolean(catalogError || catalog?.errorCode);
    return (<section className="panel" aria-labelledby="results-heading">
      <div className="results-head">
        <h2 id="results-heading">Matches</h2>
        <div className="row-actions">
          <button type="button" className="primary" onClick={onEdit}>
            Edit search
          </button>
          <button type="button" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
      <dl className="summary">
        <div>
          <dt>Area</dt>
          <dd>{state.area.trim()}</dd>
        </div>
        <div>
          <dt>Hunting</dt>
          <dd>{state.mode === "solo" ? "Solo" : `Roommates, household of ${state.householdSize}`}</dd>
        </div>
        <div>
          <dt>Total monthly budget</dt>
          <dd>{parsed.ok && parsed.budget != null ? formatMoney(parsed.budget) : "No ceiling"}</dd>
        </div>
        <div>
          <dt>Priorities</dt>
          <dd>{state.priorities.map((id, index) => `${index + 1}. ${PRIORITY_LABELS[id]}`).join(" · ")}</dd>
        </div>
      </dl>
      <p className="help">
        Bedroom count is a size fact only. It does not mean a listing fits your household. The first
        priority has the strongest effect on order. Sample commute estimates use {DEMO_COMMUTE_DESTINATION} and are not applied to imported posts.
      </p>
      {liveFailed ? <p className="warning" role="status">Live import did not succeed. Matching sample cards below are fixtures, not a substitute feed.</p> : null}
      {state.priorities.length === 0 ? (<div className="empty" role="status">
          <p>Choose at least one priority before Roost ranks sample listings.</p>
          <button type="button" className="primary" onClick={onEdit}>
            Back to priorities
          </button>
        </div>) : !areaKnown ? (<div className="empty" role="status">
          <p>No listings for “{state.area.trim()}”. Roost will not substitute a different area or the search source name.</p>
          <button type="button" className="primary" onClick={onEdit}>
            Edit area
          </button>
        </div>) : outcomeEligible.length === 0 ? (<div className="empty" role="status">
          <p>
            No listings in this area
            {budget != null ? ` are at or under ${formatMoney(budget)} applicable monthly rent` : ""}. Unknown,
            ambiguous, weekly, and roommate-household room rents are not treated as a passing total.
          </p>
          <button type="button" className="primary" onClick={onEdit}>
            Edit search
          </button>
        </div>) : (<ol className="cards">
          {outcomeEligible.map((item, index) => (<ListingCard key={item.listing.id} item={item} rank={index + 1} useful={state.useful.find((entry) => entry.id === item.listing.id)} mode={state.mode} onToggle={onToggle} onNote={onNote}/>))}
        </ol>)}
      {excludedUnknownRent > 0 ? (<p className="help">
          {excludedUnknownRent} listing{excludedUnknownRent === 1 ? "" : "s"} in this area
          {excludedUnknownRent === 1 ? " has" : " have"} unknown or ambiguous rent and {excludedUnknownRent === 1 ? "was" : "were"} left
          out of the budget filter.
        </p>) : null}
      {excludedInapplicableRent > 0 ? (<p className="help">
          {excludedInapplicableRent} listing{excludedInapplicableRent === 1 ? "" : "s"} in this area cannot pass the total budget because the rate is not a comparable monthly total.
        </p>) : null}
      {unlocated.length > 0 ? (<section className="outside" aria-labelledby="unlocated-heading">
          <h3 id="unlocated-heading">Imported offers with no explicit city</h3>
          <p className="help">These posts were not assigned a city from the search source.</p>
          <ul>
            {unlocated.map((listing) => (<li key={listing.id}>
                <p><strong>{listing.title}</strong> <span className="status">Unverified imported offer</span></p>
                {listing.sourceUrl ? <p><a href={listing.sourceUrl} target="_blank" rel="noreferrer">View listing</a></p> : null}
              </li>))}
          </ul>
        </section>) : null}
      {outside.length > 0 ? (<section className="outside" aria-labelledby="outside-heading">
          <h3 id="outside-heading">Useful listings outside this search</h3>
          <ul>
            {outside.map((item) => (<li key={item.id}>
                <p>
                  <strong>{titles.get(item.id) ?? item.id}</strong>
                  <span className="status"> Not in current results</span>
                </p>
                <label htmlFor={`outside-note-${item.id}`}>Note</label>
                <textarea id={`outside-note-${item.id}`} value={item.note} onChange={(event) => onNote(item.id, event.target.value)}/>
                <button type="button" onClick={() => onToggle(item.id)}>
                  Unmark useful
                </button>
              </li>))}
          </ul>
        </section>) : null}
    </section>);
}
function ListingCard({ item, rank, useful, mode, onToggle, onNote, }) {
    const listing = item.listing;
    const importedCard = listingOrigin(listing) === "imported";
    return (<li className="card">
      <div className="card-top">
        <p className="rank-badge">#{rank} {importedCard ? "imported" : "sample"}</p>
        <p className="status">{importedCard ? "Unverified imported offer" : useful ? "Matches current search" : "Sample fixture"}</p>
      </div>
      <h3>{listing.title}</h3>
      <p className="where">
        {[listing.neighborhood, listing.city].filter(Boolean).join(", ") || "City not stated in the post"}
      </p>
      {importedCard ? <p className="help">{offerKindLabel(listing.offerKind)} from {listing.sourceGroup || "a configured listing source"}. Not verified current availability.{listing.postedAt ? ` Posted ${listing.postedAt}.` : " Post time unknown."}{listing.importedAt ? ` Imported ${formatTimestamp(listing.importedAt)}.` : ""}</p> : null}
      {listing.sourceUrl ? <p><a href={listing.sourceUrl} target="_blank" rel="noreferrer">View listing</a></p> : null}
      <dl className="facts">
        <div>
          <dt>Rent</dt>
          <dd>{rentFact(listing, mode)}</dd>
        </div>
        <div>
          <dt>Beds / room type</dt>
          <dd>{listing.roomLabel}</dd>
        </div>
        <div>
          <dt>Furnished</dt>
          <dd>{yesNoUnknown(listing.furnished)}</dd>
        </div>
        <div>
          <dt>Pets</dt>
          <dd>{yesNoUnknown(listing.pets)}</dd>
        </div>
        <div>
          <dt>Parking</dt>
          <dd>{yesNoUnknown(listing.parking)}</dd>
        </div>
        <div>
          <dt>Lease</dt>
          <dd>{leaseFact(listing.leaseMonths)}</dd>
        </div>
        <div>
          <dt>Sample commute</dt>
          <dd>
            {listing.commuteMinutes == null
            ? `Unknown. Estimates, when present, are to ${DEMO_COMMUTE_DESTINATION}.`
            : `${listing.commuteMinutes} min to ${DEMO_COMMUTE_DESTINATION}`}
          </dd>
        </div>
      </dl>
      <Explanation title="Matched priorities" items={item.matches} empty="No selected priority is a clear match."/>
      <Explanation title="Tradeoffs" items={item.tradeoffs} empty="No known tradeoff among your priorities."/>
      <Explanation title="Unknown facts" items={item.unknowns} empty="No unknown facts among your priorities."/>
      <div className="useful-box">
        <button type="button" onClick={() => onToggle(listing.id)} aria-pressed={useful ? true : false}>
          {useful ? "Unmark useful" : "Mark useful"}
        </button>
        {useful ? (<div className="field">
            <label htmlFor={`note-${listing.id}`}>Note for the team</label>
            <textarea id={`note-${listing.id}`} value={useful.note} onChange={(event) => onNote(listing.id, event.target.value)}/>
          </div>) : null}
      </div>
    </li>);
}
function Explanation({ title, items, empty, }) {
    return (<div className="explain">
      <h4>{title}</h4>
      {items.length === 0 ? (<p>{empty}</p>) : (<ul>
          {items.map((item) => (<li key={item.id}>
              <strong>{PRIORITY_LABELS[item.id]}:</strong> {item.detail}
            </li>))}
        </ul>)}
    </div>);
}
function FeedbackPanel({ state, exported, onFeedback, onReset, showReset, }) {
    const json = JSON.stringify(exported, null, 2);
    return (<section className="panel feedback" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading">Feedback for the PRD</h2>
      <p className="help">
        Download stays on your device. Roost does not send feedback to the team. Share the file
        yourself if you want it reviewed. PRD changes remain a human decision.
      </p>
      <div className="field">
        <label htmlFor="feedback">Missing features or confusing behavior (optional)</label>
        <textarea id="feedback" value={state.generalFeedback} onChange={(event) => onFeedback(event.target.value)}/>
      </div>
      <h3>Readable summary</h3>
      <dl className="summary">
        <div>
          <dt>Schema</dt>
          <dd>
            v{exported.schemaVersion}, {exported.includesImportedData ? "sample and imported data" : "sample data"}
          </dd>
        </div>
        <div>
          <dt>Area</dt>
          <dd>{exported.area || "Not entered"}</dd>
        </div>
        <div>
          <dt>Hunting mode</dt>
          <dd>
            {exported.huntingMode}
            {exported.householdSize ? `, household ${exported.householdSize}` : ""}
          </dd>
        </div>
        <div>
          <dt>Total monthly budget</dt>
          <dd>{exported.totalMonthlyBudget == null ? "Not set" : formatMoney(exported.totalMonthlyBudget)}</dd>
        </div>
        <div>
          <dt>Ordered priorities</dt>
          <dd>
            {exported.priorities.length
            ? exported.priorities.map((id) => PRIORITY_LABELS[id]).join(", ")
            : "None"}
          </dd>
        </div>
        <div>
          <dt>Useful listings</dt>
          <dd>
            {exported.usefulListings.length === 0
            ? "None"
            : exported.usefulListings
                .map((item) => `${item.title} (${item.id})${item.note ? `: ${item.note}` : ""}${item.currentlyMatching ? "" : " — not in current results"}`)
                .join("; ")}
          </dd>
        </div>
        <div>
          <dt>General feedback</dt>
          <dd>{exported.generalFeedback || "None"}</dd>
        </div>
      </dl>
      <div className="row-actions">
        <button type="button" className="primary" onClick={() => downloadJson(json)}>
          Download JSON
        </button>
        {showReset ? (<button type="button" onClick={onReset}>
            Reset
          </button>) : null}
      </div>
    </section>);
}
function ImportPanel({ catalog, catalogError, refreshing, onRefresh }) {
    return (<section className="panel" aria-labelledby="import-heading">
      <h2 id="import-heading">Craigslist import</h2>
      <p className="help">The server reads configured Craigslist search URLs. A failed refresh keeps the last successful import. Sample fixtures stay labeled and are not used to fill a failed import.</p>
      {catalogError ? <p className="warning" role="alert">{catalogError}</p> : null}
      {!catalog && !catalogError ? <p role="status">Loading import status.</p> : null}
      {catalog?.error ? <p className="warning" role="status">{catalog.error}{catalog.stale && catalog.importedAt ? ` Last successful import ${formatTimestamp(catalog.importedAt)}.` : ""}</p> : null}
      {catalog && !catalog.error && catalog.importedAt ? <p role="status">Last successful import {formatTimestamp(catalog.importedAt)}.</p> : null}
      {catalog?.sources?.length ? <ul className="source-list">{catalog.sources.map((source) => <li key={source.id}><strong>{source.label}</strong> <span className="status">{source.status}, retrieved {source.retrieved}, accepted {source.accepted}. {source.message}</span></li>)}</ul> : <p className="help">Configured sources: {catalog?.configuredSources?.map((source) => source.label).join(", ") || "loading"}.</p>}
      <button type="button" className="primary" onClick={onRefresh} disabled={refreshing || !catalog}>{refreshing ? "Refreshing import" : "Refresh Craigslist listings"}</button>
    </section>);
}
function catalogStatus(catalog) {
    if (catalog.errorCode)
        return catalog.errorCode;
    if (catalog.stale)
        return "stale";
    if (catalog.importedAt && catalog.listings.length === 0)
        return "empty";
    if (catalog.importedAt)
        return "ok";
    return "not_imported";
}
function importBanner(catalog, catalogError, refreshing) {
    if (refreshing)
        return "Refreshing configured Craigslist searches. This does not replace saved listings until the fetch finishes.";
    if (catalogError)
        return catalogError;
    if (!catalog)
        return "Checking the Craigslist import status. Sample fixtures are labeled and are not a live feed.";
    if (catalog.error)
        return catalog.error;
    if (catalog.listings.length > 0)
        return "Imported posts are unverified Craigslist offers. Sample fixtures remain labeled separately.";
    return "No imported offers are cached yet. Sample fixtures are labeled and are not live availability.";
}
function formatTimestamp(value) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed))
        return value;
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}
async function loadCatalog(refresh = false) {
    const response = await fetch(refresh ? "/api/listings/refresh" : "/api/listings", {
        method: refresh ? "POST" : "GET",
        headers: { accept: "application/json" },
    });
    if (!response.ok)
        throw new Error("catalog request failed");
    return response.json();
}
function downloadJson(json) {
    const blob = new Blob([json + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "roost-search-feedback.json";
    link.click();
    URL.revokeObjectURL(url);
}
