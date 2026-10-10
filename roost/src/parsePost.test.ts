import { describe, expect, it } from "vitest";
import { applyRefresh, emptySnapshot, publicCatalog, redactSecrets } from "./importCache";
import { rankListings } from "./matching";
import { applicableMonthlyRent } from "./model";
import { parseGroupPost, type RawGroupPost } from "./parsePost";
import { resolveSources, sourceFromRef } from "./sources";

function post(text: string, overrides: Partial<RawGroupPost> = {}): RawGroupPost {
  return {
    groupId: "1074031543398636",
    groupLabel: "SCU Apartments and Housing",
    groupUrl: "https://www.facebook.com/groups/1074031543398636",
    postId: "2339420803526364",
    postUrl: "https://www.facebook.com/groups/santaclarau/posts/2339420803526364/",
    postedAt: "2h",
    text,
    fetchedAt: "2026-10-10T19:55:00.000Z",
    ...overrides,
  };
}

describe("facebook post parsing", () => {
  it("keeps a room offer and does not copy the group city when the post names another city", () => {
    const result = parseGroupPost(
      post("Private room in San Jose available. $1,450/month. Furnished. No pets. 6 month lease. Available now. 400 sq ft."),
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.listing.city).toBe("San Jose");
    expect(result.listing.city).not.toBe("Santa Clara");
    expect(result.listing.offerKind).toBe("room");
    expect(result.listing.rentBasis).toBe("monthly-room");
    expect(result.listing.rent).toBe(1450);
    expect(result.listing.furnished).toBe(true);
    expect(result.listing.pets).toBe(false);
    expect(result.listing.leaseMonths).toBe(6);
    expect(result.listing.sqft).toBe(400);
    expect(result.listing.commuteMinutes).toBeNull();
    expect(result.listing.sourceUrl).toContain("/posts/2339420803526364");
    expect(result.listing.availability).toBe("Available now");
  });

  it("does not infer a city from the group when the post has none", () => {
    const result = parseGroupPost(post("Private room available. $900/month. Parking included."));
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.listing.city).toBe("");
    expect(result.listing.neighborhood).toBe("");
    expect(result.listing.parking).toBe(true);
  });

  it("excludes housing-wanted and unrelated posts", () => {
    expect(parseGroupPost(post("Looking for a room in Santa Clara under $1000.")).accepted).toBe(false);
    expect(parseGroupPost(post("Selling a couch in San Jose, $200.")).accepted).toBe(false);
  });

  it("supports whole-unit and sublet offers without guessing a weekly rate into a monthly budget", () => {
    const whole = parseGroupPost(
      post("2BR apartment for rent in Santa Clara, $3200 per month, pets ok, 12 month lease.", {
        postId: "2",
      }),
    );
    const sublet = parseGroupPost(
      post("Subletting my room in Sunnyvale until August. $1600/month.", { postId: "3" }),
    );
    const weekly = parseGroupPost(post("Room in Cupertino $400/week.", { postId: "4" }));
    expect(whole.accepted && whole.listing.rentBasis).toBe("monthly-total");
    expect(sublet.accepted && sublet.listing.offerKind).toBe("sublet");
    expect(sublet.accepted && sublet.listing.rentBasis).toBe("monthly-room");
    expect(weekly.accepted && weekly.listing.rentBasis).toBe("nonmonthly");
    if (!weekly.accepted) return;
    expect(applicableMonthlyRent(weekly.listing, "solo")).toBeNull();
  });

  it("does not let an ambiguous amount pass a monthly ceiling", () => {
    const result = parseGroupPost(post("Apartment for rent in Mountain View. $2800 or $3000."));
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.listing.rentBasis).toBe("unknown");
    expect(applicableMonthlyRent(result.listing, "solo")).toBeNull();
    const ranked = rankListings([result.listing], "Mountain View", 4000, ["price"], "solo");
    expect(ranked.eligible).toEqual([]);
    expect(ranked.excludedUnknownRent).toBe(1);
  });
});

describe("import cache", () => {
  it("dedupes the same source post and preserves the prior set when refresh fails", () => {
    const first = parseGroupPost(post("Private room in Santa Clara available $1100/month."));
    const repeat = parseGroupPost(post("Private room in Santa Clara available $1100/month. Furnished.", { fetchedAt: "2026-10-10T20:00:00.000Z" }));
    if (!first.accepted || !repeat.accepted) throw new Error("expected offers");
    const initial = applyRefresh(emptySnapshot(), {
      ok: true,
      code: null,
      error: null,
      fetchedAt: "2026-10-10T19:55:00.000Z",
      sources: [{ id: "1074031543398636", url: "https://www.facebook.com/groups/1074031543398636", label: "SCU", status: "success", retrieved: 2, message: "Retrieved posts." }],
      posts: [post("Private room in Santa Clara available $1100/month."), post("Looking for a room in Santa Clara.")],
    }, "2026-10-10T19:55:00.000Z");
    expect(initial.listings).toHaveLength(1);
    expect(initial.sources[0]?.accepted).toBe(1);
    const again = applyRefresh(initial, {
      ok: true,
      code: null,
      error: null,
      fetchedAt: "2026-10-10T20:00:00.000Z",
      sources: [{ id: "1074031543398636", url: "https://www.facebook.com/groups/1074031543398636", label: "SCU", status: "success", retrieved: 1, message: "Retrieved posts." }],
      posts: [post("Private room in Santa Clara available $1100/month. Furnished.", { fetchedAt: "2026-10-10T20:00:00.000Z" })],
    }, "2026-10-10T20:00:00.000Z");
    expect(again.listings).toHaveLength(1);
    expect(again.listings[0]?.furnished).toBe(true);
    const failed = applyRefresh(again, {
      ok: false,
      code: "login_challenge",
      error: "Stopped at a login page. Previous results were kept.",
      fetchedAt: null,
      sources: [{ id: "1074031543398636", url: "https://www.facebook.com/groups/1074031543398636", label: "SCU", status: "login_challenge", retrieved: 0, message: "Login page." }],
      posts: [],
    }, "2026-10-10T20:05:00.000Z");
    expect(failed.listings).toEqual(again.listings);
    expect(failed.importedAt).toBe(again.importedAt);
    expect(failed.stale).toBe(true);
    expect(failed.errorCode).toBe("login_challenge");
    expect(repeat.listing.id).toBe(first.listing.id);
  });

  it("does not put cookie names or values in the public catalog", () => {
    const catalog = publicCatalog(emptySnapshot(), [], true);
    const encoded = JSON.stringify(catalog);
    expect(encoded).not.toContain("c_user");
    expect(encoded).not.toContain("xs");
    expect(redactSecrets("cookie xs=secret-value", ["secret-value"])).toBe("cookie xs=[redacted]");
  });
});

describe("configured sources", () => {
  it("accepts a Craigslist search URL without using fixture cities", () => {
    const source = sourceFromRef("https://sfbay.craigslist.org/search/sby/apa");
    expect(source?.url).toBe("https://sfbay.craigslist.org/search/sby/apa");
    expect(source?.id).not.toBe("sunnyvale");
    const resolved = resolveSources(
      [{ id: "sby-apa", url: "https://sfbay.craigslist.org/search/sby/apa", label: "South Bay" }],
      "https://sfbay.craigslist.org/search/sby/apa?query=santa+clara",
    );
    expect(resolved[0]?.url).toContain("query=santa+clara");
  });
});

describe("craigslist cards", () => {
  it("treats an apartments-category price as monthly whole-unit rent and keeps the stated city", () => {
    const result = parseGroupPost(
      post("Remarkable value. san jose downtown. $2,723 per month", {
        postId: "7Fbc1UHwbZjLiikQs4yPxL",
        postUrl: "https://sfbay.craigslist.org/sby/apa/d/example/7Fbc1UHwbZjLiikQs4yPxL",
        groupId: "sby-apa",
        groupLabel: "Craigslist South Bay apartments",
        title: "Remarkable value",
        listingCategory: "apartment",
      }),
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.listing.city).toBe("San Jose");
    expect(result.listing.rent).toBe(2723);
    expect(result.listing.rentBasis).toBe("monthly-total");
    expect(result.listing.offerKind).toBe("whole");
    expect(result.listing.commuteMinutes).toBeNull();
    expect(result.listing.title).toBe("Remarkable value");
  });
});
