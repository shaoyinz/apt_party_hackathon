import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isSampleListing } from "./catalogSelection";
import { LISTINGS } from "./fixtures";
import {
    addNote,
    addShortlist,
    bestValueIds,
    createGroup,
    currentSignalIds,
    factText,
    filterListings,
    findInvite,
    groupScore,
    joinGroup,
    listingStatus,
    memberCommute,
    missingFacts,
    perPersonRent,
    regenerateInvite,
    removeMember,
    removeShortlist,
    renameMember,
    revealContact,
    setMemberDestination,
    setTouring,
    shortlistSummary,
    sortListings,
    toggleSignal,
    updateQuestion,
    validateFilters,
} from "./groups";
import { BEST_VALUE_NOTE, COMMUTE_DESTINATIONS, formatMoney, yesNoUnknown } from "./model";

const NOT_LISTED = "Not listed";
const SAMPLE_COMMUTE_LABEL = COMMUTE_DESTINATIONS[0].label;
const EMPTY_FILTERS = {
    text: "",
    minPrice: "",
    maxPrice: "",
    minBeds: "",
    maxCommute: "",
    status: "any",
    source: "any",
    sort: "score",
};

export function GroupDemo({ state, warning, route, listings = LISTINGS, catalogMode = "sample", onPatch, onReplaceGroup, onReset }) {
    const group = state.groups.find((item) => item.id === (route.groupId || state.activeGroupId)) ?? null;
    const member = group?.members.find((item) => item.id === state.activeMemberId) ?? group?.members[0] ?? null;
    function replace(next, extra = {}) {
        onReplaceGroup(next, extra);
    }
    if (route.kind === "join")
        return <JoinScreen state={state} token={route.token} warning={warning} onPatch={onPatch} onReplaceGroup={replace}/>;
    if (!group || route.kind === "home")
        return <HomeScreen state={state} warning={warning} onPatch={onPatch} onReset={onReset}/>;
    return (<Shell state={state} group={group} member={member} warning={warning} route={route.kind} catalogMode={catalogMode} onPatch={onPatch} onReplace={replace}>
      {route.kind === "compare" ? <Compare listings={listings} group={group} member={member} priorities={state.priorities} catalogMode={catalogMode} onReplace={replace}/> : null}
      {route.kind === "group" ? <GroupScreen group={group} member={member} onReplace={replace} onPatch={onPatch}/> : null}
      {route.kind !== "compare" && route.kind !== "group" ? <Feed listings={listings} group={group} member={member} priorities={state.priorities} catalogMode={catalogMode} onReplace={replace}/> : null}
    </Shell>);
}

function HomeScreen({ state, warning, onPatch, onReset }) {
    const [name, setName] = useState("Sunnyvale hunters");
    const [display, setDisplay] = useState("");
    const [error, setError] = useState("");
    function create(event) {
        event.preventDefault();
        const result = createGroup(name, display);
        if (result.error) {
            setError(result.error);
            return;
        }
        onPatch({
            groups: [...state.groups, result.group],
            activeGroupId: result.group.id,
            activeMemberId: result.member.id,
            view: "feed",
        });
        window.location.hash = `/g/${result.group.id}/feed`;
    }
    return (<section className="panel" aria-labelledby="home-heading">
      <h2 id="home-heading">Private group demo</h2>
      <p className="help">Group activity stays in this browser. Invite links do not open the group on another device. This is not an account and not a privacy guarantee.</p>
      {warning ? <p className="warning" role="status">{warning}</p> : null}
      <form onSubmit={create} noValidate>
        <div className="field">
          <label htmlFor="group-name">Group name</label>
          <input id="group-name" value={name} onChange={(event) => setName(event.target.value)}/>
        </div>
        <div className="field">
          <label htmlFor="display-name">Your display name</label>
          <input id="display-name" value={display} onChange={(event) => setDisplay(event.target.value)}/>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="primary" type="submit">Create local group</button>
      </form>
      {state.groups.length ? (<ul className="member-list">
          {state.groups.map((group) => (<li key={group.id}>
              <button type="button" onClick={() => openGroup(group, onPatch)}>{group.name}</button>
              <span className="help">{group.members.length} demo members</span>
            </li>))}
        </ul>) : <p className="help">No local groups yet.</p>}
      <div className="row-actions">
        <a className="btn" href="#/">Saved search</a>
        <button type="button" onClick={onReset}>Reset</button>
      </div>
    </section>);
}

function JoinScreen({ state, token, warning, onPatch }) {
    const found = findInvite(state.groups, token);
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    function submit(event) {
        event.preventDefault();
        if (found.status !== "ok")
            return;
        const result = joinGroup(found.group, name);
        if (result.error) {
            setError(result.error);
            return;
        }
        onPatch({
            groups: state.groups.map((group) => (group.id === result.group.id ? result.group : group)),
            activeGroupId: result.group.id,
            activeMemberId: result.member.id,
            view: "feed",
        });
        window.location.hash = `/g/${result.group.id}/feed`;
    }
    return (<section className="panel" aria-labelledby="join-heading">
      <p className="eyebrow">Private invite</p>
      <h2 id="join-heading">{found.status === "ok" ? found.group.name : "Invite unavailable"}</h2>
      {warning ? <p className="warning" role="status">{warning}</p> : null}
      {found.status === "unavailable" ? <p role="alert">This invite is not in this browser. A fresh browser cannot join a group that was created somewhere else. Create a local group instead.</p> : null}
      {found.status === "revoked" ? <p role="alert">This invite was regenerated and no longer works in this browser.</p> : null}
      {found.status === "ok" ? (<form onSubmit={submit} noValidate>
          <p className="help">Pick the name this browser will show on votes, vetoes, and comments. Joining here only adds a demo member on this device.</p>
          <div className="field">
            <label htmlFor="join-name">Display name</label>
            <input id="join-name" value={name} onChange={(event) => setName(event.target.value)}/>
          </div>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button className="primary" type="submit">Join group</button>
        </form>) : <a className="btn" href="#/groups">Back home</a>}
    </section>);
}

function Shell({ state, group, member, warning, route, catalogMode = "sample", onPatch, onReplace, children }) {
    const link = inviteHref(group.inviteToken);
    return (<div className="demo-app">
      <header className="top">
        <div>
          <p className="eyebrow">Browser-only demo</p>
          <h1>Roost</h1>
        </div>
        <div>
          <p className="eyebrow">Group</p>
          <strong>{group.name}</strong>
        </div>
        <nav className="nav" aria-label="Group">
          <a className={route === "feed" ? "active" : ""} href={`#/g/${group.id}/feed`}>Feed</a>
          <a className={route === "compare" ? "active" : ""} href={`#/g/${group.id}/compare`}>Compare</a>
          <a className={route === "group" ? "active" : ""} href={`#/g/${group.id}/group`}>Group</a>
        </nav>
        <label className="switcher">
          Acting as
          <select aria-label="Demo member" value={member?.id ?? ""} onChange={(event) => onPatch({ activeMemberId: event.target.value })}>
            {group.members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <a className="btn" href="#/">Search</a>
        <a className="btn" href="#/">Export</a>
        <button type="button" onClick={() => onPatch({ theme: state.theme === "dark" ? "light" : "dark" })}>
          {state.theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </header>
      {warning ? <p className="warning" role="status">{warning}</p> : null}
      <p className="help banner-copy" role="status">{catalogBanner(catalogMode)} Group activity stays in this browser and is not indexed. Invite {link} works only where this group is already saved.</p>
      {children}
    </div>);
}

function Feed({ listings, group, member, priorities, catalogMode = "sample", onReplace }) {
    const [draft, setDraft] = useState(EMPTY_FILTERS);
    const [errors, setErrors] = useState({});
    const [sheetOpen, setSheetOpen] = useState(false);
    const [justAdded, setJustAdded] = useState("");
    const closeRef = useRef(null);
    const openRef = useRef(null);
    const validated = validateFilters(draft);
    const active = { ...validated.parsed, text: draft.text, status: draft.status, source: draft.source };
    const scoreOf = (listing) => groupScore(listing, priorities).value;
    const scoreNote = groupScore(listings[0] ?? { rent: null, commuteMinutes: null, beds: null }, priorities).note;
    const filtered = useMemo(() => {
        if (Object.keys(validated.errors).length)
            return [];
        return sortListings(filterListings(listings, group, active), draft.sort, scoreOf);
    }, [group, draft, priorities, listings]);
    const shortlisted = group.shortlist.map((id) => listings.find((listing) => listing.id === id)).filter(Boolean);
    const hiddenSaved = group.shortlist.length - shortlisted.length;
    const sources = [...new Set(listings.map((listing) => listing.source).filter(Boolean))];
    const summary = shortlistSummary(shortlisted, scoreOf);
    const best = bestValueIds(Object.keys(validated.errors).length ? [] : filtered);
    function apply(event) {
        event.preventDefault();
        setErrors(validated.errors);
    }
    function add(id) {
        const next = addShortlist(group, id);
        if (next !== group) {
            setJustAdded(id);
            onReplace(next);
        }
    }
    useEffect(() => {
        if (sheetOpen)
            closeRef.current?.focus();
    }, [sheetOpen]);
    return (<div className="workspace">
      <form className="toolbar" onSubmit={apply}>
        <label className="search">
          Search
          <input aria-label="Search title, neighborhood, or address" value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })}/>
        </label>
        <label>Min price<input inputMode="decimal" aria-label="Minimum price" value={draft.minPrice} onChange={(event) => setDraft({ ...draft, minPrice: event.target.value })}/></label>
        <label>Max price<input inputMode="decimal" aria-label="Maximum price" value={draft.maxPrice} onChange={(event) => setDraft({ ...draft, maxPrice: event.target.value })}/></label>
        <label>Bedrooms<input inputMode="numeric" aria-label="Minimum bedrooms" value={draft.minBeds} onChange={(event) => setDraft({ ...draft, minBeds: event.target.value })}/></label>
        <label>Commute<input inputMode="numeric" aria-label="Maximum commute minutes" value={draft.maxCommute} onChange={(event) => setDraft({ ...draft, maxCommute: event.target.value })}/></label>
        <label>Status
          <select aria-label="Status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            <option value="any">Any</option>
            <option value="open">Open</option>
            <option value="shortlisted">Shortlisted</option>
            <option value="touring">Touring</option>
          </select>
        </label>
        <label>Source
          <select aria-label="Source" value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}>
            <option value="any">Any</option>
            {sources.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
        <label>Sort
          <select aria-label="Sort" value={draft.sort} onChange={(event) => setDraft({ ...draft, sort: event.target.value })}>
            <option value="score">Group score</option>
            <option value="price">Price</option>
            <option value="commute">Commute</option>
            <option value="newest">Newest</option>
          </select>
        </label>
        <button className="primary" type="submit">Apply filters</button>
        <button type="button" onClick={() => { setDraft(EMPTY_FILTERS); setErrors({}); }}>Clear all</button>
      </form>
      <p className="help">{scoreNote} {BEST_VALUE_NOTE}</p>
      <ActiveFilters draft={draft}/>
      {Object.entries(errors).map(([key, message]) => <p key={key} className="error" role="alert">{message}</p>)}
      <div className="layout">
        <div>
          <p className="help" role="status">{Object.keys(validated.errors).length ? "Fix the filters to see results." : catalogMode === "loading" ? "Checking listing sources." : `${filtered.length} listing${filtered.length === 1 ? "" : "s"}`}</p>
          {catalogMode === "real" && hiddenSaved ? <p className="help" role="status">Saved sample references are hidden and are not counted. They were not converted into real listings.</p> : null}
          {filtered.length === 0 && !Object.keys(validated.errors).length ? <p className="empty" role="status">{catalogMode === "sample" ? "No sample listings match. Clear filters to see the shortlist, which is kept separately." : "No listings match. Sample fixtures were not added. Clear filters to see the shortlist, which is kept separately."}</p> : null}
          <div className="feed">
            {filtered.map((listing) => <ListingCard key={listing.id} listing={listing} group={group} member={member} priorities={priorities} best={best.has(listing.id)} justAdded={justAdded === listing.id} onAdd={() => add(listing.id)} onRemove={() => onReplace(removeShortlist(group, listing.id))} onReplace={onReplace}/>)}
          </div>
        </div>
        <ShortlistRail groupId={group.id} summary={summary} listings={shortlisted} justAdded={justAdded} onRemove={(id) => onReplace(removeShortlist(group, id))} onDrop={add}/>
      </div>
      <button ref={openRef} type="button" className="sheet-toggle" onClick={() => setSheetOpen(true)}>Shortlist {shortlisted.length}</button>
      {sheetOpen ? <div className="sheet" role="dialog" aria-label="Shortlist">
          <button ref={closeRef} type="button" onClick={() => { setSheetOpen(false); openRef.current?.focus(); }}>Close shortlist</button>
          <ShortlistBody summary={summary} listings={shortlisted} justAdded={justAdded} onRemove={(id) => onReplace(removeShortlist(group, id))}/>
        </div> : null}
    </div>);
}

function ActiveFilters({ draft }) {
    const chips = [];
    if (draft.text.trim())
        chips.push(`Search “${draft.text.trim()}”`);
    if (draft.minPrice || draft.maxPrice)
        chips.push(`Price ${draft.minPrice || "any"}–${draft.maxPrice || "any"}`);
    if (draft.minBeds)
        chips.push(`${draft.minBeds}+ bedrooms`);
    if (draft.maxCommute)
        chips.push(`Commute ≤ ${draft.maxCommute} min`);
    if (draft.status !== "any")
        chips.push(`Status ${draft.status}`);
    if (draft.source !== "any")
        chips.push(draft.source);
    chips.push(draft.sort === "score" ? "Sort: group score" : `Sort: ${draft.sort}`);
    return <p className="chips">{chips.map((chip) => <span key={chip}>{chip}</span>)}</p>;
}

function ListingCard({ listing, group, member, priorities, best, justAdded, onAdd, onRemove, onReplace }) {
    const score = groupScore(listing, priorities);
    const status = listingStatus(group, listing.id);
    const votes = currentSignalIds(group, listing.id, "vote");
    const vetoes = currentSignalIds(group, listing.id, "veto");
    const shortlisted = group.shortlist.includes(listing.id);
    return (<article className="card" draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", listing.id)}>
      <div>
        <p className="status">{statusLabel(status)}{best ? <span className="good"> Best value</span> : null}</p>
        <h2>{listing.title}</h2>
        <p className="meta">{listing.neighborhood}, {listing.city} · Address: {factText(listing.address)}</p>
        <div className="facts">
          <span className={best ? "fact good num" : "fact num"}>{priceFact(listing)}</span>
          <span className="fact">{listing.beds == null ? `Bedrooms: ${NOT_LISTED}` : `${listing.beds} bed`}</span>
          <span className="fact num">{listing.commuteMinutes == null ? `Commute: ${NOT_LISTED}` : isSampleListing(listing) ? `${listing.commuteMinutes} min sample` : `${listing.commuteMinutes} min`}</span>
          <span className={listing.pets == null ? "fact miss" : "fact"}>Pets: {yesNoUnknown(listing.pets)}</span>
          <span className="fact">{listing.source ?? NOT_LISTED}</span>
          <Contact listing={listing} group={group} member={member} onReplace={onReplace}/>
        </div>
        <div className="signals">
          <span>{votes.length} vote{votes.length === 1 ? "" : "s"}</span>
          <span className={vetoes.length ? "bad" : ""}>{vetoes.length} veto{vetoes.length === 1 ? "" : "es"}</span>
        </div>
      </div>
      <div className="score">
        <b className={best ? "good num" : "num"}>{score.value == null ? NOT_LISTED : score.value.toFixed(1)}</b>
        <span>{score.kind === "preference" ? "Preference score" : "Demo group score"}</span>
        <div className="actions">
          <button type="button" aria-pressed={votes.includes(member.id)} onClick={() => onReplace(toggleSignal(group, listing.id, member.id, "vote"))}>Vote</button>
          <button type="button" className="bad-btn" aria-pressed={vetoes.includes(member.id)} onClick={() => onReplace(toggleSignal(group, listing.id, member.id, "veto"))}>Veto</button>
          {shortlisted ? <button type="button" onClick={onRemove}>Remove</button> : <button type="button" className="primary" onClick={onAdd}>Shortlist</button>}
        </div>
        {justAdded ? <p className="sr-only" role="status">Added to shortlist</p> : null}
      </div>
    </article>);
}

function Contact({ listing, group, member, onReplace }) {
    if (!listing.contact)
        return <span className="fact miss">Contact: {NOT_LISTED}</span>;
    const revealed = group.revealed[listing.id];
    if (!revealed)
        return <button type="button" onClick={() => onReplace(revealContact(group, listing, member).group)}>Contact hidden. Reveal</button>;
    return <span className="fact">Revealed by {revealed.memberName}: {listing.contact.name}, {listing.contact.phone}</span>;
}

function ShortlistRail({ groupId, summary, listings, justAdded, onRemove, onDrop }) {
    return (<aside className="rail" aria-label="Shortlist" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
        event.preventDefault();
        const id = event.dataTransfer.getData("text/plain");
        if (id)
            onDrop(id);
    }}>
      <h3>Shortlist · {listings.length}</h3>
      <p className="help">Drop a listing here, or use Shortlist. Keyboard users can use the Shortlist button.</p>
      <ShortlistBody summary={summary} listings={listings} justAdded={justAdded} onRemove={onRemove}/>
      <a className="btn primary" href={`#/g/${groupId}/compare`}>Compare shortlist</a>
    </aside>);
}

function ShortlistBody({ summary, listings, justAdded, onRemove }) {
    return (<>
      <div className="stats">
        <Stat label="Rent range" value={summary.rentRange ? `${formatMoney(summary.rentRange.min)}–${formatMoney(summary.rentRange.max)}` : NOT_LISTED} coverage={summary.rentRange ? `${summary.rentRange.known} of ${summary.rentRange.total} known` : "0 known"}/>
        <Stat label="Avg commute" value={summary.avgCommute ? `${summary.avgCommute.value} min` : NOT_LISTED} coverage={summary.avgCommute ? `${summary.avgCommute.known} of ${summary.avgCommute.total} known` : "0 known"}/>
        <Stat label="Avg score" value={summary.avgScore ? String(summary.avgScore.value) : NOT_LISTED} coverage={summary.avgScore ? `${summary.avgScore.known} of ${summary.avgScore.total} known` : "0 known"}/>
        <Stat label="Missing facts" value={String(summary.missing.length)} coverage="listing and field"/>
      </div>
      {listings.map((listing) => <div key={listing.id} className={listing.id === justAdded ? "pick pick-in" : "pick"}>
          <div><strong>{listing.title}</strong><span className="num">{priceFact(listing)}</span></div>
          <button type="button" onClick={() => onRemove(listing.id)}>Remove</button>
        </div>)}
      {summary.missing.length ? <ul className="missing">{summary.missing.map((fact) => <li key={`${fact.listingId}-${fact.label}`} className="miss">{fact.title}: {fact.label} {NOT_LISTED}</li>)}</ul> : <p className="help">No missing facts in the shortlist.</p>}
    </>);
}

function Stat({ label, value, coverage }) {
    return <div className="stat"><b className="num">{value}</b><span>{label}</span><span className="help">{coverage}</span></div>;
}

function Compare({ listings, group, member, priorities, catalogMode = "sample", onReplace }) {
    const selected = group.shortlist.map((id) => listings.find((listing) => listing.id === id)).filter(Boolean);
    const hiddenSaved = group.shortlist.length - selected.length;
    const [drafts, setDrafts] = useState({});
    const [error, setError] = useState("");
    if (!selected.length)
        return <p className="empty" role="status">{catalogMode !== "sample" && hiddenSaved ? "Saved sample references are hidden while real listings are in use. They were not converted into real listings." : "Shortlist a listing before comparing. The shortlist is empty."}</p>;
    function ask(listingId) {
        const result = addNote(group, listingId, member, drafts[listingId] ?? "", "question");
        if (result.error) {
            setError(result.error);
            return;
        }
        setDrafts({ ...drafts, [listingId]: "" });
        setError("");
        onReplace(result.group);
    }
    return (<div className="compare-wrap">
      <p className="help">Per-person rent is an equal split across {group.members.length} current demo members, not a landlord quote. Commute is shown only for a member who selected {SAMPLE_COMMUTE_LABEL}. Other destinations stay {NOT_LISTED}.</p>
      <div className="compare-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Fact</th>
              {selected.map((listing) => <th key={listing.id} scope="col">{listing.title}<br/><span className="meta">{statusLabel(listingStatus(group, listing.id))}</span></th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Rent</th>
              {selected.map((listing) => <td key={listing.id} className="num">{priceFact(listing)}</td>)}
            </tr>
            <tr>
              <th scope="row">Per person</th>
              {selected.map((listing) => {
                const value = perPersonRent(listing.rent, group.members.length);
                return <td key={listing.id} className="num">{value == null ? NOT_LISTED : formatMoney(value)}</td>;
            })}
            </tr>
            <tr>
              <th scope="row">Votes</th>
              {selected.map((listing) => <td key={listing.id}><SignalNames group={group} listingId={listing.id} kind="vote"/> <span className="bad"><SignalNames group={group} listingId={listing.id} kind="veto" veto/></span></td>)}
            </tr>
            <tr>
              <th scope="row">Commute</th>
              {selected.map((listing) => <td key={listing.id}>{group.members.map((person) => {
                const minutes = memberCommute(listing, person);
                return <span key={person.id} className="num">{person.name} {minutes == null ? NOT_LISTED : isSampleListing(listing) ? `${minutes} min sample` : `${minutes} min`}. </span>;
            })}</td>)}
            </tr>
            <tr>
              <th scope="row">Missing facts</th>
              {selected.map((listing) => <td key={listing.id} className="miss">{missingFacts(listing).map((fact) => fact.label).join(", ") || "None"}</td>)}
            </tr>
            <tr>
              <th scope="row">Tour questions</th>
              {selected.map((listing) => <td key={listing.id}>
                  {group.questions.filter((question) => question.listingId === listing.id).map((question) => <Question key={question.id} question={question} group={group} onReplace={onReplace}/>)}
                  <label className="sr-only" htmlFor={`q-${listing.id}`}>Tour question for {listing.title}</label>
                  <input id={`q-${listing.id}`} value={drafts[listing.id] ?? ""} onChange={(event) => setDrafts({ ...drafts, [listing.id]: event.target.value })}/>
                  <button type="button" onClick={() => ask(listing.id)}>Add question</button>
                </td>)}
            </tr>
            <tr>
              <th scope="row">Next</th>
              {selected.map((listing) => <td key={listing.id}>
                  {listingStatus(group, listing.id) === "touring"
                    ? <button type="button" onClick={() => onReplace(setTouring(group, listing.id, false))}>Return to shortlisted</button>
                    : <button type="button" className="primary" onClick={() => onReplace(setTouring(group, listing.id, true))}>Move to Touring</button>}
                  <CommentBox group={group} listing={listing} member={member} onReplace={onReplace}/>
                </td>)}
            </tr>
          </tbody>
        </table>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>);
}

function SignalNames({ group, listingId, kind, veto = false }) {
    const ids = currentSignalIds(group, listingId, kind);
    if (!ids.length)
        return veto ? "0 vetoes" : "0 votes";
    const names = ids.map((id) => group.members.find((member) => member.id === id)?.name ?? id).join(", ");
    return veto ? `${ids.length} veto: ${names}` : `${ids.length} vote: ${names}`;
}

function Question({ question, group, onReplace }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(question.text);
    const [error, setError] = useState("");
    function save() {
        const result = updateQuestion(group, question.id, value);
        if (result.error) {
            setError(result.error);
            return;
        }
        setEditing(false);
        onReplace(result.group);
    }
    return <p>{editing ? <><input aria-label="Edit tour question" value={value} onChange={(event) => setValue(event.target.value)}/><button type="button" onClick={save}>Save question</button>{error ? <span className="error">{error}</span> : null}</> : <>{question.memberName}: {question.text} <button type="button" onClick={() => setEditing(true)}>Edit</button></>}</p>;
}

function CommentBox({ group, listing, member, onReplace }) {
    const fieldId = useId();
    const [text, setText] = useState("");
    const [error, setError] = useState("");
    const comments = group.comments.filter((comment) => comment.listingId === listing.id);
    function send() {
        const result = addNote(group, listing.id, member, text, "comment");
        if (result.error) {
            setError(result.error);
            return;
        }
        setText("");
        setError("");
        onReplace(result.group);
    }
    return <div>
      {comments.map((comment) => <p key={comment.id}>{comment.memberName}: {comment.text}</p>)}
      <label className="sr-only" htmlFor={fieldId}>Comment on {listing.title}</label>
      <input id={fieldId} value={text} onChange={(event) => setText(event.target.value)}/>
      <button type="button" onClick={send}>Add comment</button>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>;
}

function GroupScreen({ group, member, onReplace, onPatch }) {
    const [name, setName] = useState(member?.name ?? "");
    const [error, setError] = useState("");
    const [copied, setCopied] = useState("");
    const link = inviteHref(group.inviteToken);
    function rename(event) {
        event.preventDefault();
        const result = renameMember(group, member.id, name);
        if (result.error) {
            setError(result.error);
            return;
        }
        setError("");
        onReplace(result.group);
    }
    function remove(target) {
        if (!window.confirm(`Remove ${target.name} from this local demo group?`))
            return;
        const result = removeMember(group, target.id);
        if (result.error) {
            setError(result.error);
            return;
        }
        const nextMember = result.group.members[0];
        onReplace(result.group, { activeMemberId: member.id === target.id ? nextMember.id : member.id });
    }
    async function copy() {
        try {
            await navigator.clipboard.writeText(link);
            setCopied("Copied");
        }
        catch {
            setCopied("Select the invite and copy it manually.");
        }
    }
    function regenerate() {
        if (!window.confirm("Regenerate the invite? The previous link will stop working in this browser."))
            return;
        onReplace(regenerateInvite(group));
        setCopied("");
    }
    return (<div className="group-grid">
      <section className="panel" aria-labelledby="members-heading">
        <h2 id="members-heading">Members</h2>
        <p className="help">You are acting as {member?.name}. Switching members is a demo control, not a login.</p>
        <ul className="member-list">
          {group.members.map((item) => <li key={item.id}><strong>{item.name}</strong>{item.id === member?.id ? " · active demo identity" : ""} <button type="button" onClick={() => remove(item)}>Remove</button></li>)}
        </ul>
        <form onSubmit={rename}>
          <label htmlFor="rename">Display name</label>
          <input id="rename" value={name} onChange={(event) => setName(event.target.value)}/>
          <button className="primary" type="submit">Save name</button>
        </form>
        <label htmlFor="destination">Sample commute destination</label>
        <select id="destination" value={member?.commuteDestinationId ?? ""} onChange={(event) => onReplace(setMemberDestination(group, member.id, event.target.value))}>
          <option value="">Not set</option>
          {COMMUTE_DESTINATIONS.map((destination) => <option key={destination.id} value={destination.id}>{destination.label}</option>)}
        </select>
        <p className="help">Only {SAMPLE_COMMUTE_LABEL} has sample minutes. Other choices stay {NOT_LISTED}.</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>
      <section className="panel" aria-labelledby="invite-heading">
        <h2 id="invite-heading">Invite link</h2>
        <p>Anyone using this browser can join by picking a display name. The link contains no member details or contacts. Groups are private and are not indexed.</p>
        <p className="linkbox"><span>{link}</span></p>
        <div className="row-actions">
          <button type="button" className="primary" onClick={copy}>Copy</button>
          <button type="button" onClick={regenerate}>Regenerate invite</button>
          <a className="btn" href="#/groups">All local groups</a>
        </div>
        {copied ? <p role="status">{copied}</p> : null}
        <p className="help">Opening this link in a browser that does not already have the group shows an unavailable invite. That is expected for this demo.</p>
        <button type="button" onClick={() => onPatch({ view: "home" })}>Leave this screen</button>
      </section>
    </div>);
}

function catalogBanner(catalogMode) {
    if (catalogMode === "loading")
        return "Checking saved and scraped listings. Sample fixtures are not shown as the result.";
    if (catalogMode === "unavailable")
        return "Real listings are unavailable. Sample fixtures were not substituted.";
    if (catalogMode === "real")
        return "Real listings only. Sample fixtures are not mixed in.";
    return "Sample listings for the initial demo.";
}
function priceFact(listing) {
    if (listing.rentBasis === "for-sale")
        return `${listing.salePriceText || "Price unknown"} for sale. Not monthly rent.`;
    if (listing.rent == null)
        return NOT_LISTED;
    return formatMoney(listing.rent);
}
function statusLabel(status) {
    if (status === "touring")
        return "Touring";
    if (status === "shortlisted")
        return "Shortlisted";
    return "Open";
}

function inviteHref(token) {
    const path = `${window.location.origin}${window.location.pathname}#/join/${encodeURIComponent(token)}`;
    return path;
}

function openGroup(group, onPatch) {
    onPatch({ activeGroupId: group.id, activeMemberId: group.members[0]?.id ?? null, view: "feed" });
    window.location.hash = `/g/${group.id}/feed`;
}
