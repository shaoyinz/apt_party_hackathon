const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
export const PACIFIC_TZ = "America/Los_Angeles";
export function parsePacificLocal(value) {
    const match = LOCAL.exec(String(value ?? ""));
    if (!match)
        return { ok: false, timezone: PACIFIC_TZ };
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (month < 1 || month > 12 || hour > 23 || minute > 59)
        return { ok: false, timezone: PACIFIC_TZ };
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
        return { ok: false, timezone: PACIFIC_TZ };
    }
    return {
        ok: true,
        ymd: `${match[1]}-${match[2]}-${match[3]}`,
        gtfsDate: `${match[1]}${match[2]}${match[3]}`,
        seconds: hour * 3600 + minute * 60,
        timezone: PACIFIC_TZ,
    };
}
export function weekdayOfYmd(ymd) {
    const [year, month, day] = ymd.split("-").map(Number);
    return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}
export function servicesForDate(calendar, calendarDates, ymd) {
    const gtfsDate = ymd.replaceAll("-", "");
    const weekday = weekdayOfYmd(ymd);
    const active = new Set();
    for (const row of calendar) {
        if (gtfsDate < row.start || gtfsDate > row.end)
            continue;
        if (row[weekday] === "1" || row[weekday] === 1 || row[weekday] === true)
            active.add(row.serviceId);
    }
    for (const row of calendarDates) {
        if (row.date !== gtfsDate)
            continue;
        if (String(row.exceptionType) === "1")
            active.add(row.serviceId);
        else if (String(row.exceptionType) === "2")
            active.delete(row.serviceId);
    }
    return active;
}
export function formatPacificClock(ymd, seconds) {
    const dayOffset = Math.floor(seconds / 86400);
    const sod = ((seconds % 86400) + 86400) % 86400;
    const hour24 = Math.floor(sod / 3600);
    const minute = Math.floor((sod % 3600) / 60);
    const date = addDays(ymd, dayOffset);
    const hour12 = hour24 % 12 || 12;
    const suffix = hour24 < 12 ? "AM" : "PM";
    return `${date} ${hour12}:${String(minute).padStart(2, "0")} ${suffix} PT`;
}
function addDays(ymd, days) {
    const [year, month, day] = ymd.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
export function journeyMinutes(startSeconds, arrivalSeconds) {
    return Math.round((arrivalSeconds - startSeconds) / 60);
}
