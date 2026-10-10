import { randomUUID } from "node:crypto";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function connectionFromUrl(url) {
    const options = { connectionString: url };
    let sslmode = "";
    try {
        sslmode = new URL(url).searchParams.get("sslmode") || "";
    }
    catch {
        sslmode = "";
    }
    if (sslmode === "require" || sslmode === "verify-ca" || sslmode === "verify-full")
        options.ssl = { rejectUnauthorized: true };
    return options;
}

export function databaseConfig() {
    const url = process.env.DATABASE_URL;
    const host = process.env.PGHOST;
    const schema = process.env.DB_SCHEMA || "public";
    if (!IDENTIFIER.test(schema))
        return { configured: false, reason: "DB_SCHEMA is not a safe identifier." };
    if (!url && !host)
        return { configured: false, reason: "DATABASE_URL and PGHOST are unset." };
    return {
        configured: true,
        schema,
        connection: url
            ? connectionFromUrl(url)
            : {
                host,
                port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
                user: process.env.PGUSER,
                password: process.env.PGPASSWORD,
                database: process.env.PGDATABASE,
                ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined,
            },
    };
}

export async function createPgRepository() {
    const config = databaseConfig();
    if (!config.configured)
        return { configured: false, reason: config.reason };
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ ...config.connection, max: 4, connectionTimeoutMillis: 4000 });
    const schema = config.schema;
    return {
        configured: true,
        kind: "postgres",
        async ping() {
            const client = await pool.connect();
            try {
                await client.query(`SET search_path TO ${quoteIdent(schema)}, public`);
                await client.query("SELECT 1");
            }
            finally {
                client.release();
            }
        },
        async ensureMember(label) {
            return withClient(pool, schema, async (client) => {
                const group = await client.query("INSERT INTO groups (name) VALUES ($1) RETURNING id", [label]);
                const member = await client.query("INSERT INTO members (group_id, name) VALUES ($1, $2) RETURNING id", [group.rows[0].id, label]);
                return { groupId: group.rows[0].id, memberId: member.rows[0].id, name: label };
            });
        },
        async memberInGroup(memberId, groupId) {
            return withClient(pool, schema, async (client) => {
                const found = await client.query("SELECT 1 FROM members WHERE id = $1 AND group_id = $2", [memberId, groupId]);
                return found.rowCount === 1;
            });
        },
        async findIdempotent(groupId, idempotencyKey) {
            return withClient(pool, schema, async (client) => {
                const existing = await client.query("SELECT id FROM listings WHERE group_id = $1 AND field_confidence->>'idempotencyKey' = $2", [groupId, idempotencyKey]);
                if (!existing.rows[0])
                    return null;
                return readListing(client, existing.rows[0].id, groupId);
            });
        },
        async saveImport(input) {
            return withClient(pool, schema, async (client) => {
                await client.query("BEGIN");
                try {
                    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${input.groupId}:${input.idempotencyKey}`]);
                    const existing = await client.query("SELECT id FROM listings WHERE group_id = $1 AND field_confidence->>'idempotencyKey' = $2", [input.groupId, input.idempotencyKey]);
                    if (existing.rows[0]) {
                        await client.query("COMMIT");
                        return { id: existing.rows[0].id, created: false, listing: await readListing(client, existing.rows[0].id, input.groupId) };
                    }
                    const id = input.id || randomUUID();
                    await client.query(`INSERT INTO listings (
                        id, group_id, created_by, source, source_url, image_urls, raw_text, title, address,
                        price_monthly, room_type, beds, baths, sqft, available_from, lease_months, furnished,
                        utilities_included, pets, parking, status, field_confidence
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'New',$21
                    )`, [
                        id,
                        input.groupId,
                        input.memberId,
                        input.record.source,
                        input.record.sourceUrl,
                        input.record.imageUrls,
                        input.record.rawText,
                        input.record.title,
                        input.record.address,
                        input.record.priceMonthly,
                        input.record.roomType,
                        input.record.beds,
                        input.record.baths,
                        input.record.sqft,
                        input.record.availableFrom,
                        input.record.leaseMonths,
                        input.record.furnished,
                        input.record.utilitiesIncluded,
                        input.record.pets,
                        input.record.parking,
                        input.record.fieldConfidence,
                    ]);
                    for (const attribute of input.attributes) {
                        const inserted = await client.query(`INSERT INTO listing_attributes (listing_id, attribute_id, value, source, verified)
                            SELECT $1, id, $2::jsonb, $3, false FROM attribute_definitions WHERE name = $4`, [
                            id,
                            JSON.stringify(attribute.value),
                            input.record.source,
                            attribute.name,
                        ]);
                        if (inserted.rowCount !== 1)
                            throw new Error(`Attribute definition missing: ${attribute.name}`);
                    }
                    await client.query("COMMIT");
                    const listing = await readListing(client, id, input.groupId);
                    listing.city = input.record.city;
                    listing.neighborhood = input.record.neighborhood;
                    return { id, created: true, listing };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            });
        },
        async listGroup(groupId) {
            return withClient(pool, schema, async (client) => {
                const rows = await client.query("SELECT id FROM listings WHERE group_id = $1 ORDER BY created_at ASC", [groupId]);
                const listings = [];
                for (const row of rows.rows)
                    listings.push(await readListing(client, row.id, groupId));
                return listings;
            });
        },
        async getForGroup(listingId, groupId) {
            return withClient(pool, schema, async (client) => readListing(client, listingId, groupId));
        },
    };
}

function quoteIdent(value) {
    if (!IDENTIFIER.test(value))
        throw new Error("unsafe identifier");
    return `"${value}"`;
}

async function withClient(pool, schema, work) {
    const client = await pool.connect();
    try {
        await client.query(`SET search_path TO ${quoteIdent(schema)}, public`);
        return await work(client);
    }
    finally {
        client.release();
    }
}

async function readListing(client, id, groupId) {
    const row = await client.query("SELECT * FROM listings WHERE id = $1 AND group_id = $2", [id, groupId]);
    if (!row.rows[0])
        return null;
    const item = row.rows[0];
    const attrs = await client.query(`SELECT d.name FROM listing_attributes la
        JOIN attribute_definitions d ON d.id = la.attribute_id
        WHERE la.listing_id = $1`, [id]);
    return {
        id: item.id,
        source: item.source,
        sourceUrl: item.source_url,
        imageUrls: item.image_urls,
        rawText: item.raw_text,
        title: item.title,
        address: item.address,
        city: item.field_confidence?.city || null,
        neighborhood: item.field_confidence?.neighborhood || null,
        priceMonthly: item.price_monthly,
        roomType: item.room_type,
        beds: item.beds,
        baths: item.baths,
        sqft: item.sqft,
        availableFrom: item.available_from,
        leaseMonths: item.lease_months,
        furnished: item.furnished,
        utilitiesIncluded: item.utilities_included,
        pets: item.pets,
        parking: item.parking,
        status: item.status,
        amenities: attrs.rows.map((attr) => attr.name),
        fieldConfidence: item.field_confidence,
    };
}
