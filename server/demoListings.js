import { createClient } from "@supabase/supabase-js";
import { DEMO_GROUP_ID, adaptListing } from "../src/lib/listings.js";
export async function demoCatalog() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key)
        return { status: "fallback", listings: [] };
    try {
        const supabase = createClient(url, key);
        const { data, error } = await supabase
            .from("listings")
            .select("id,demo_fixture_id,title,city,neighborhood,price_monthly,beds,sqft,room_type,furnished,pets,parking,lease_months,demo_commute_minutes")
            .eq("group_id", DEMO_GROUP_ID)
            .eq("source", "seed")
            .order("demo_fixture_id");
        if (error || !data?.length)
            return { status: "fallback", listings: [] };
        return { status: "database", listings: data.map(adaptListing) };
    }
    catch {
        return { status: "fallback", listings: [] };
    }
}
