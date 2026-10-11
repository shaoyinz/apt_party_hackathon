# Listing geocode

Confirmed bring-your-own locations are stored on `field_confidence.location`, not a new coordinate column. The value includes `lat`, `lon`, `label`, `precision` (`address`, `neighborhood`, or `city`), `query`, and source `OpenStreetMap via Nominatim`.

`POST /api/location/geocode` with `purpose: "listing"` classifies street matches separately from destination geocoding. The import confirm and `POST /api/imports/saved/:id/location` handlers re-geocode that query before saving. A mismatched query is rejected. Provider failure still allows the listing to be saved, without coordinates.

Search uses `toSearchListing` coordinates with the existing commute and convenience calculations. Unresolved listings stay unavailable and are not scored as zero.