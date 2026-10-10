import { useEffect, useMemo, useState } from "react";
import { cancelImport, confirmImport, extractImport, loadHealth, openImportSession } from "./importApi";
import { UPLOAD_LIMITS, UPLOAD_LIMIT_LABEL, FETCH_LIMIT_LABEL } from "./import/limits";

const AMENITIES = [
    "In-unit laundry", "On-site laundry", "Air conditioning", "Heating", "Dishwasher", "Balcony",
    "Gym", "Swimming pool", "Bike storage", "Dedicated workspace", "Pet friendly", "Utilities included",
    "Internet included", "Covered parking", "EV charging",
];

export function ImportFlow({ onClose, onSaved }) {
    const [health, setHealth] = useState(null);
    const [sessionError, setSessionError] = useState("");
    const [url, setUrl] = useState("");
    const [files, setFiles] = useState([]);
    const [fileError, setFileError] = useState("");
    const [phase, setPhase] = useState("input");
    const [status, setStatus] = useState("");
    const [draft, setDraft] = useState(null);
    const [fields, setFields] = useState(emptyDraft());
    const [attributes, setAttributes] = useState([]);
    const [confirmed, setConfirmed] = useState(false);
    const [idempotencyKey, setIdempotencyKey] = useState("");
    useEffect(() => {
        let cancelled = false;
        loadHealth()
            .then((next) => {
            if (!cancelled)
                setHealth(next);
        })
            .catch((error) => {
            if (!cancelled)
                setSessionError(error.message);
        });
        openImportSession().catch((error) => {
            if (!cancelled)
                setSessionError(error.message);
        });
        return () => {
            cancelled = true;
        };
    }, []);
    const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
    useEffect(() => () => {
        for (const preview of previews)
            URL.revokeObjectURL(preview.url);
    }, [previews]);
    function addFiles(list) {
        const next = [...files];
        const errors = [];
        for (const file of list) {
            const typeOk = UPLOAD_LIMITS.formats.includes(file.type);
            if (!typeOk)
                errors.push(`${file.name} is not a JPEG, PNG, WEBP, or GIF.`);
            else if (file.size > UPLOAD_LIMITS.maxBytesEach)
                errors.push(`${file.name} is over 8 MB.`);
            else if (file.size === 0)
                errors.push(`${file.name} is empty.`);
            else
                next.push(file);
        }
        if (next.length > UPLOAD_LIMITS.maxImages)
            errors.push("Upload at most 8 screenshots for one listing.");
        const total = next.reduce((sum, file) => sum + file.size, 0);
        if (total > UPLOAD_LIMITS.maxBytesTotal)
            errors.push("Those screenshots exceed the 24 MB total limit.");
        setFileError(errors.join(" "));
        if (errors.length === 0)
            setFiles(next.slice(0, UPLOAD_LIMITS.maxImages));
    }
    async function runExtract(manual) {
        setStatus(manual ? "Opening a blank draft. Nothing is saved yet." : "Reading the listing. Nothing is saved yet.");
        setPhase("working");
        try {
            const images = await Promise.all(files.map(fileToPayload));
            const result = await extractImport({ url: url.trim(), images });
            setDraft(result);
            setFields({ ...emptyDraft(), ...result.fields });
            setAttributes(result.attributes || []);
            setConfirmed(false);
            setIdempotencyKey(newId());
            setStatus(result.warnings?.[0] || "Review every fact before saving. Confirmation does not verify availability.");
            setPhase("review");
        }
        catch (error) {
            setStatus(error.message);
            setPhase("input");
        }
    }
    async function save() {
        setPhase("working");
        setStatus("Saving to the group database.");
        try {
            const result = await confirmImport({
                draftId: draft?.draftId,
                idempotencyKey,
                confirmed: true,
                fields,
                attributes,
                conflicts: draft?.conflicts || [],
                sourceUrl: draft?.sourceUrl || url.trim(),
                rawText: draft?.rawText || "",
            });
            setStatus("Saved. This listing is user-provided and unverified.");
            setPhase("saved");
            onSaved(result.listings || []);
        }
        catch (error) {
            setStatus(`${error.message} The draft is still here.`);
            setPhase("review");
        }
    }
    async function cancel() {
        await cancelImport(draft?.draftId).catch(() => undefined);
        onClose();
    }
    return (<section className="panel" aria-labelledby="import-heading">
      <div className="results-head">
        <h2 id="import-heading">Bring your own listing</h2>
        <button type="button" onClick={cancel}>Close</button>
      </div>
      <p className="help">One listing at a time, shared only with your hunting group. {UPLOAD_LIMIT_LABEL} Links: {FETCH_LIMIT_LABEL}.</p>
      {health?.database !== "ok" ? (<p className="warning" role="status">Database save is not available yet{health?.databaseReason ? `: ${health.databaseReason}` : ""}. You can still prepare a draft.</p>) : null}
      {health?.ocr === "unavailable" ? (<p className="warning" role="status">Python OCR is not installed. Screenshots can still be stored, and you can type the facts.</p>) : null}
      {sessionError ? <p className="error" role="alert">{sessionError}</p> : null}
      {status ? <p className="local-note" role="status">{status}</p> : null}
      {phase !== "review" && phase !== "saved" ? (<div>
          <div className="field">
            <label htmlFor="listing-url">Listing link</label>
            <input id="listing-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://"/>
          </div>
          <div className="field">
            <label htmlFor="listing-shots">Screenshots</label>
            <input id="listing-shots" type="file" accept={UPLOAD_LIMITS.formats.join(",")} multiple onChange={(event) => addFiles([...event.target.files])}/>
            {fileError ? <p className="error" role="alert">{fileError}</p> : null}
          </div>
          {previews.length > 0 ? (<ul className="shots">
              {previews.map((preview) => (<li key={preview.url}>
                  <img src={preview.url} alt=""/>
                  <button type="button" onClick={() => setFiles(files.filter((file) => file !== preview.file))}>Remove {preview.file.name}</button>
                </li>))}
            </ul>) : null}
          <div className="row-actions">
            <button type="button" className="primary" disabled={phase === "working"} onClick={() => runExtract(false)}>Extract facts</button>
            <button type="button" disabled={phase === "working"} onClick={() => runExtract(true)}>Enter manually</button>
          </div>
        </div>) : null}
      {phase === "review" || phase === "saved" ? (<Review fields={fields} setFields={setFields} attributes={attributes} setAttributes={setAttributes} notes={draft?.notes || {}} conflicts={draft?.conflicts || []} previews={previews} url={draft?.sourceUrl || url} confirmed={confirmed} setConfirmed={setConfirmed} onSave={save} onCancel={cancel} busy={phase === "working"} saved={phase === "saved"}/>) : null}
    </section>);
}

function Review({ fields, setFields, attributes, setAttributes, notes, conflicts, previews, url, confirmed, setConfirmed, onSave, onCancel, busy, saved }) {
    function set(key, value) {
        setFields((current) => ({ ...current, [key]: value }));
    }
    const selected = new Set(attributes.map((item) => item.name));
    return (<form onSubmit={(event) => {
            event.preventDefault();
            if (!saved)
                onSave();
        }}>
      <p className="stamp">User-provided, unverified</p>
      {url ? <p className="help">Source link: {url}</p> : null}
      {conflicts.length > 0 ? <p className="warning" role="status">Conflicting facts were left blank: {conflicts.join(", ")}.</p> : null}
      {previews.length > 0 ? (<ul className="shots">
          {previews.map((preview) => (<li key={preview.url}><img src={preview.url} alt="Screenshot preview"/></li>))}
        </ul>) : null}
      <div className="import-grid">
        <Field label="Title" value={fields.title} note={notes.title} onChange={(value) => set("title", value)}/>
        <Field label="Address" value={fields.address} note={notes.address} onChange={(value) => set("address", value)}/>
        <Field label="City" value={fields.city} note={notes.city} onChange={(value) => set("city", value)}/>
        <Field label="Neighborhood" value={fields.neighborhood} onChange={(value) => set("neighborhood", value)}/>
        <Field label="Available from" value={fields.availableFrom} note={notes.availableFrom} onChange={(value) => set("availableFrom", value)} placeholder="YYYY-MM-DD"/>
        <Field label="Monthly rent" value={fields.priceMonthly} note={notes.priceMonthly || fields.priceRaw} onChange={(value) => set("priceMonthly", value)}/>
        <label className="field">Room type
          <select value={fields.roomType || ""} onChange={(event) => set("roomType", event.target.value)}>
            <option value="">Unknown</option>
            <option value="entire">Entire place</option>
            <option value="private_room">Private room</option>
            <option value="shared">Shared room</option>
          </select>
        </label>
        <Field label="Bedrooms" value={fields.beds} note={notes.beds} onChange={(value) => set("beds", value)}/>
        <Field label="Bathrooms" value={fields.baths} onChange={(value) => set("baths", value)}/>
        <Field label="Square feet" value={fields.sqft} onChange={(value) => set("sqft", value)}/>
        <Field label="Lease months" value={fields.leaseMonths} onChange={(value) => set("leaseMonths", value)}/>
        <Tri label="Furnished" value={fields.furnished} onChange={(value) => set("furnished", value)}/>
        <Tri label="Utilities included" value={fields.utilitiesIncluded} onChange={(value) => set("utilitiesIncluded", value)}/>
        <Field label="Pets" value={fields.pets} onChange={(value) => set("pets", value)}/>
        <Field label="Parking" value={fields.parking} onChange={(value) => set("parking", value)}/>
      </div>
      <fieldset>
        <legend>Amenities found in the text</legend>
        <div className="add-row">
          {AMENITIES.map((name) => (<label key={name} className="choice">
              <input type="checkbox" checked={selected.has(name)} onChange={(event) => {
                    setAttributes(event.target.checked
                        ? [...attributes, { name, value: true }]
                        : attributes.filter((item) => item.name !== name));
                }}/>
              {name}
            </label>))}
        </div>
      </fieldset>
      <label className="choice">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/>
        I reviewed this draft. Saving does not mean the listing is independently verified.
      </label>
      <div className="row-actions">
        <button className="primary" type="submit" disabled={!confirmed || busy || saved}>Save listing</button>
        <button type="button" onClick={onCancel}>Cancel without saving</button>
      </div>
    </form>);
}

function Field({ label, value, note, onChange, placeholder }) {
    return (<label className="field">{label}
      <input value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)}/>
      {note ? <span className="help">{note}</span> : null}
    </label>);
}

function Tri({ label, value, onChange }) {
    return (<label className="field">{label}
      <select value={value == null ? "" : value ? "true" : "false"} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "true")}>
        <option value="">Unknown</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </label>);
}

function emptyDraft() {
    return {
        title: "", address: "", city: "", neighborhood: "", availableFrom: "", priceMonthly: "",
        priceRaw: "", priceIssue: null, roomType: "", beds: "", baths: "", sqft: "", leaseMonths: "",
        furnished: null, utilitiesIncluded: null, pets: "", parking: "",
    };
}

function newId() {
    return crypto.randomUUID().replace(/-/g, "");
}

function fileToPayload(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
        reader.onload = () => {
            const value = String(reader.result || "");
            resolve({ name: file.name, type: file.type, dataBase64: value.slice(value.indexOf(",") + 1) });
        };
        reader.readAsDataURL(file);
    });
}
