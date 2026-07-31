// Rentvine's API returns city/state per unit but no county, and the lease
// template needs a county for the "personal residence located in ___
// County, New Jersey" clause. This is a static lookup rather than a live
// API call since NJ municipality-to-county mapping doesn't change.
const NJ_CITY_TO_COUNTY: Record<string, string> = {
  "montclair": "Essex",
  "north bergen": "Hudson",
  "east orange": "Essex",
  "newark": "Essex",
  "bloomfield": "Essex",
  "roselle": "Union",
  "woodland park": "Passaic",
  "trenton": "Mercer",
  "pompton lakes": "Passaic",
  "west orange": "Essex",
  "belleville": "Essex",
  "garfield": "Bergen",
  "union city": "Hudson",
  "wayne": "Passaic",
  "north plainfield": "Somerset",
  "jersey city": "Hudson",
};

export function getCountyForCity(city: string | null | undefined): string | null {
  if (!city) return null;
  return NJ_CITY_TO_COUNTY[city.trim().toLowerCase()] ?? null;
}
