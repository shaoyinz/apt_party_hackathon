import { useEffect, useMemo, useState } from "react";
import { LISTINGS } from "./fixtures";
import { buildExport } from "./feedback";
import { rankListings } from "./matching";
import { AMENITY_LABELS } from "./location/score";
import { AREA_SUGGESTIONS, LEASE_FLEX_MAX_MONTHS, PACIFIC_TZ, PRIORITY_IDS, PRIORITY_LABELS, TRAVEL_LABELS, TRAVEL_MODES, emptyState, formatMoney, leaseFact, parseBudget, validateSearch, yesNoUnknown } from "./model";
import { clearState, loadState, probeBrowserStore, saveState } from "./storage";
import { useLocationMetrics } from "./useLocationMetrics";
const store = probeBrowserStore();
export function App() {
    const initial = loadState(store);
    const [state, setState] = useState(initial.state);
    const [warning, setWarning] = useState(initial.warning);
    const [errors, setErrors] = useState({});
    const [submitted, setSubmitted] = useState(false);
    useEffect(() => {
        const next = saveState(store, state);
        if (next)
            setWarning(next);
    }, [state]);
    const parsedBudget = parseBudget(state.budgetText);
    const budget = parsedBudget.ok ? parsedBudget.budget : null;
    const location = useLocationMetrics(state, setState, state.view === "results");
    const outcome = useMemo(() => rankListings(LISTINGS, state.area, budget, state.priorities, {
        metricsById: location.metricsById,
        commuteMode: state.travelMode,
        destinationLabel: location.geocode.place?.label || state.destination.trim(),
    }), [budget, location.geocode.place, location.metricsById, state.area, state.destination, state.priorities, state.travelMode]);
    const matchingIds = useMemo(() => new Set(outcome.eligible.map((item) => item.listing.id)), [outcome]);
    const titles = useMemo(() => new Map(LISTINGS.map((listing) => [listing.id, listing.title])), []);
    const exported = useMemo(() => buildExport(state, titles, matchingIds, {
        resolutionStatus: location.geocode.status,
        listingMetrics: LISTINGS.map((listing) => ({
            id: listing.id,
            originPrecision: listing.origin?.precision ?? "missing",
            commute: location.commute.signature === location.signature
                ? (location.commute.byId[listing.id] ?? { status: "not_calculated" })
                : { status: "not_calculated" },
            convenience: location.amenities.byId[listing.id] ?? { status: "not_calculated" },
            sources: { commute: location.commute.source, convenience: location.amenities.source },
        })),
    }), [location, matchingIds, state, titles]);
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
        <p className="stamp">Sample data</p>
        <div>
          <p className="eyebrow">South Bay scratch prototype</p>
          <h1>Roost</h1>
        </div>
      </header>
      <p className="banner" role="note">
        These listings are fixtures, not live availability. Calculating commute or convenience sends
        destination and listing coordinates to OpenStreetMap-based geocoding, routing, and amenity
        services. Transit times are scheduled estimates, not live delays or fares. Nothing is sent
        to the team unless you share an export yourself.
      </p>
      {warning ? (<p className="warning" role="status">
          {warning} Saved data stays in this browser only.
        </p>) : (        <p className="local-note">Search inputs stay in this browser. Commute calculations use external location services.</p>)}

      {state.view === "setup" ? (<SearchForm state={state} errors={submitted ? errors : {}} onArea={(area) => update({ area })} onMode={(mode) => update({ mode })} onHousehold={(householdSize) => update({ householdSize })} onBudget={(budgetText) => update({ budgetText })} onDestination={(destination) => update({ destination, confirmedDestination: null })} onTravelMode={(travelMode) => update({ travelMode })} onDeparture={(transitDeparture) => update({ transitDeparture })} onAdd={(id) => update({ priorities: [...state.priorities, id] })} onRemove={(id) => update({ priorities: state.priorities.filter((item) => item !== id) })} onMove={movePriority} onSubmit={onSubmit}/>) : (<Results state={state} location={location} outcomeEligible={outcome.eligible} areaKnown={outcome.areaKnown} excludedUnknownRent={outcome.excludedUnknownRent} budget={budget} outside={outside} titles={titles} onEdit={() => update({ view: "setup" })} onDestination={(destination) => update({ destination, confirmedDestination: null })} onTravelMode={(travelMode) => update({ travelMode })} onDeparture={(transitDeparture) => update({ transitDeparture })} onToggle={toggleUseful} onNote={setNote} onReset={reset}/>)}

      <FeedbackPanel state={state} exported={exported} onFeedback={(generalFeedback) => update({ generalFeedback })} onReset={reset} showReset={state.view === "setup"}/>
      <p className="attribution">
        Routing, geocoding, and amenity data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>.
        Transit schedules: VTA and Caltrain GTFS. Driving estimates do not include live traffic.
      </p>
    </div>);
}
function SearchForm({ state, errors, onArea, onMode, onHousehold, onBudget, onDestination, onTravelMode, onDeparture, onAdd, onRemove, onMove, onSubmit, }) {
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
          Select one or more, then arrange them from most important to least. Commute uses the
          calculated time for the destination below. Convenience is a 0–100 proximity score.
          Lease flexibility means a listed term of {LEASE_FLEX_MAX_MONTHS} months or less.
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

      <CommuteFields state={state} onDestination={onDestination} onTravelMode={onTravelMode} onDeparture={onDeparture}/>
      <button className="primary" type="submit">
        View matches
      </button>
    </form>);
}
function CommuteFields({ state, onDestination, onTravelMode, onDeparture }) {
    return (<fieldset>
      <legend>Commute destination</legend>
      <div className="field">
        <label htmlFor="destination">Where are you commuting?</label>
        <input id="destination" name="destination" value={state.destination} onChange={(event) => onDestination(event.target.value)} autoComplete="off" aria-describedby="destination-help"/>
        <p id="destination-help" className="help">
          One destination. Coordinates are sent to OpenStreetMap services when you view matches.
          Ambiguous places must be confirmed. Sample listing origins are approximate, not street addresses.
        </p>
      </div>
      <div className="mode-row" role="radiogroup" aria-label="Travel mode">
        {TRAVEL_MODES.map((mode) => (<label key={mode} className="choice">
          <input type="radio" name="travel-mode" checked={state.travelMode === mode} onChange={() => onTravelMode(mode)}/>
          {TRAVEL_LABELS[mode]}
        </label>))}
      </div>
      {state.travelMode === "transit" ? (<div className="field">
        <label htmlFor="departure">Departure ({PACIFIC_TZ})</label>
        <input id="departure" type="datetime-local" value={state.transitDeparture} onChange={(event) => onDeparture(event.target.value)} aria-describedby="departure-help"/>
        <p id="departure-help" className="help">
          Required for public transit. This is America/Los_Angeles time, not the browser timezone.
          Initial coverage is scheduled VTA and Caltrain service.
        </p>
      </div>) : (<p className="help">Driving estimates do not include live traffic. Cycling and walking use OSM street routes.</p>)}
    </fieldset>);
}
function Results({ state, location, outcomeEligible, areaKnown, excludedUnknownRent, budget, outside, titles, onEdit, onDestination, onTravelMode, onDeparture, onToggle, onNote, onReset, }) {
    const parsed = parseBudget(state.budgetText);
    return (<section className="panel" aria-labelledby="results-heading">
      <div className="results-head">
        <h2 id="results-heading">Sample matches</h2>
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
        priority has the strongest effect on order. Unavailable commute or convenience scores add
        nothing and are not called a match.
      </p>
      <CommuteFields state={state} onDestination={onDestination} onTravelMode={onTravelMode} onDeparture={onDeparture}/>
      <LocationStatus location={location}/>
      {state.priorities.length === 0 ? (<div className="empty" role="status">
          <p>Choose at least one priority before Roost ranks sample listings.</p>
          <button type="button" className="primary" onClick={onEdit}>
            Back to priorities
          </button>
        </div>) : !areaKnown ? (<div className="empty" role="status">
          <p>No sample listings for “{state.area.trim()}”. Roost will not substitute a different area.</p>
          <button type="button" className="primary" onClick={onEdit}>
            Edit area
          </button>
        </div>) : outcomeEligible.length === 0 ? (<div className="empty" role="status">
          <p>
            No sample listings in this area
            {budget != null ? ` are at or under ${formatMoney(budget)} total monthly rent` : ""}. Unknown
            rent is not treated as affordable.
          </p>
          <button type="button" className="primary" onClick={onEdit}>
            Edit search
          </button>
        </div>) : (<ol className="cards">
          {outcomeEligible.map((item, index) => (<ListingCard key={item.listing.id} item={item} rank={index + 1} commute={location.commute.byId[item.listing.id]} convenience={location.amenities.byId[item.listing.id]} commutePhase={location.commute.status} amenityPhase={location.amenities.status} useful={state.useful.find((entry) => entry.id === item.listing.id)} onToggle={onToggle} onNote={onNote} onRetry={location.retryAll}/>))}
        </ol>)}
      {excludedUnknownRent > 0 ? (<p className="help">
          {excludedUnknownRent} sample listing{excludedUnknownRent === 1 ? "" : "s"} in this area
          {excludedUnknownRent === 1 ? " has" : " have"} unknown rent and {excludedUnknownRent === 1 ? "was" : "were"} left
          out of the budget filter.
        </p>) : null}
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
function LocationStatus({ location }) {
    const place = location.geocode.place;
    return (<div className="metric" aria-live="polite">
      {location.geocode.status === "loading" || location.commute.status === "loading" ? <p>Calculating commute…</p> : null}
      {location.amenities.status === "loading" ? <p>Calculating convenience…</p> : null}
      {place ? <p>Destination: {place.label}. {location.commute.source}</p> : null}
      {location.geocode.message ? <p className="error" role="alert">{location.geocode.message}</p> : null}
      {location.geocode.status === "ambiguous" ? (<div className="candidates">
        {location.geocode.candidates.map((candidate) => (<button key={`${candidate.lat},${candidate.lon}`} type="button" onClick={() => location.choosePlace(candidate)}>
          Use {candidate.label}
        </button>))}
      </div>) : null}
      {location.geocode.status === "provider_failure" || location.commute.status === "provider_failure" || location.amenities.status === "provider_failure" ? (<button type="button" onClick={location.retryAll}>Retry location services</button>) : null}
    </div>);
}
function ListingCard({ item, rank, commute, convenience, commutePhase, amenityPhase, useful, onToggle, onNote, onRetry, }) {
    const listing = item.listing;
    return (<li className="card">
      <div className="card-top">
        <p className="rank-badge">#{rank} sample</p>
        <p className="status">{useful ? "Matches current search" : "Sample fixture"}</p>
      </div>
      <h3>{listing.title}</h3>
      <p className="where">
        {listing.neighborhood}, {listing.city}
      </p>
      <dl className="facts">
        <div>
          <dt>Total monthly rent</dt>
          <dd>{listing.rent == null ? "Unknown" : formatMoney(listing.rent)}</dd>
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
          <dt>Origin</dt>
          <dd>{listing.origin ? "Approximate sample origin. Not a verified street address." : "Missing coordinates. Commute and convenience are unavailable."}</dd>
        </div>
      </dl>
      <MetricBlock title="Commute" metric={commute} phase={commutePhase} onRetry={onRetry} commute/>
      <ConvenienceBlock metric={convenience} phase={amenityPhase} onRetry={onRetry}/>
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
function MetricBlock({ title, metric, phase, onRetry, commute = false }) {
    const status = metric?.status ?? (phase === "loading" ? "loading" : "not_calculated");
    return (<div className="metric">
      <h4>{title}</h4>
      {status === "ok" && commute ? (<p>
        {metric.minutes} min {metric.mode || "transit"}
        {metric.label ? ` · ${metric.label}` : ""}
        {metric.traffic === false && metric.mode === "driving" ? " · no live traffic" : ""}
        {metric.transfers != null ? ` · ${metric.transfers} transfer${metric.transfers === 1 ? "" : "s"}` : ""}
        {metric.lines?.length ? ` · ${metric.lines.join(", ")}` : ""}
        {metric.departureTime ? ` · departs ${metric.departureTime}` : ""}
        {metric.arrivalTime ? ` · arrives ${metric.arrivalTime}` : ""}
      </p>) : null}
      {status === "ok" && commute && metric.message ? <p className="help">{metric.message}</p> : null}
      {status === "loading" ? <p>Calculating…</p> : null}
      {status !== "ok" && status !== "loading" ? (<p>
        Unavailable{metric?.message ? `: ${metric.message}` : "."}
        <button type="button" onClick={onRetry}>Retry</button>
      </p>) : null}
      {metric?.source ? <p className="help">Source: {metric.source}</p> : null}
    </div>);
}
function ConvenienceBlock({ metric, phase, onRetry }) {
    const status = metric?.status ?? (phase === "loading" ? "loading" : "not_calculated");
    return (<div className="metric">
      <h4>Convenience</h4>
      {status === "ok" ? (<>
        <p>{metric.score}/100. {metric.method}</p>
        <ul>
          {(metric.categories ?? []).map((category) => (<li key={category.id}>
            <strong>{category.label || AMENITY_LABELS[category.id]}:</strong>{" "}
            {category.name ? `${category.name}, ${category.distanceMeters} m, ${Math.round(category.points * 10) / 10} points` : "None within 1 km, 0 points"}
          </li>))}
        </ul>
        <p className="help">{metric.message}</p>
      </>) : status === "loading" ? <p>Calculating convenience…</p> : (<p>
        Unavailable{metric?.message ? `: ${metric.message}` : ". An incomplete query is not scored as zero."}
        <button type="button" onClick={onRetry}>Retry</button>
      </p>)}
      {metric?.source ? <p className="help">Source: {metric.source}</p> : null}
    </div>);
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
            v{exported.schemaVersion}, sample data
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
          <dt>Destination</dt>
          <dd>
            {exported.commute.resolvedDestination?.label || exported.commute.destination || "Not entered"}
            {exported.commute.destination ? ` · ${exported.commute.travelMode}` : ""}
            {exported.commute.travelMode === "transit" && exported.commute.transitDeparture
              ? ` · departs ${exported.commute.transitDeparture} ${exported.commute.timezone}`
              : ""}
          </dd>
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
function downloadJson(json) {
    const blob = new Blob([json + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "roost-search-feedback.json";
    link.click();
    URL.revokeObjectURL(url);
}
