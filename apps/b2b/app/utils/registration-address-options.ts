/**
 * Options for the public registration form — better UX for country / state–province
 * without adding npm dependencies (countries via Intl.DisplayNames).
 */

import { REGISTRATION_COUNTRY_SUBDIVISIONS } from "./registration-country-subdivisions";

const SKIP_COUNTRY_LABELS = new Set([
   "Antarctica",
   "European Union",
   "Eurozone",
   "United Nations",
   "Unknown Region",
   "Pseudo-Accents",
   "Pseudo-Bidi",
   "Outlying Oceania"
]);

function buildCountryOptions(): { value: string; label: string }[] {
   const dn = new Intl.DisplayNames(["en"], { type: "region" });
   const seen = new Set<string>();
   const out: { value: string; label: string }[] = [];
   for (let i = 65; i <= 90; i++) {
      for (let j = 65; j <= 90; j++) {
         const code = String.fromCharCode(i) + String.fromCharCode(j);
         const label = dn.of(code);
         if (!label || label === code) continue;
         if (SKIP_COUNTRY_LABELS.has(label)) continue;
         if (seen.has(label)) continue;
         seen.add(label);
         out.push({ value: label, label });
      }
   }
   return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Sorted country names (value === label) for <select>. */
export const REGISTRATION_COUNTRY_OPTIONS: { value: string; label: string }[] = buildCountryOptions();

const subdivisionsLookup = REGISTRATION_COUNTRY_SUBDIVISIONS as Readonly<
   Record<string, readonly string[]>
>;

/** US states + DC — re-exported for callers that need the list alone. */
export const REGISTRATION_US_STATE_NAMES: readonly string[] = subdivisionsLookup["United States"] ?? [];

/** Canadian provinces & territories. */
export const REGISTRATION_CA_PROVINCE_NAMES: readonly string[] = subdivisionsLookup["Canada"] ?? [];

function mergeAllSubdivisionNames(): readonly string[] {
   const s = new Set<string>();
   for (const arr of Object.values(subdivisionsLookup)) {
      for (const x of arr) s.add(x);
   }
   return [...s].sort((a, b) => a.localeCompare(b));
}

/**
 * Broad hints when the country has no built-in list — every supported subdivision name
 * (many countries) so datalist still helps power users.
 */
export const REGISTRATION_STATE_PROVINCE_SUGGESTIONS: readonly string[] = mergeAllSubdivisionNames();

/** Number of countries that show a state/province <select> when chosen. */
export const REGISTRATION_COUNTRIES_WITH_SUBDIVISION_LIST_COUNT = Object.keys(subdivisionsLookup).length;

/**
 * Province/state list for the selected country (same labels as country <select> options).
 * Empty → use generic text + combined datalist on the registration form.
 */
export function getProvincesForRegistrationCountry(country: string): string[] {
   const c = String(country || "").trim();
   const list = subdivisionsLookup[c];
   return list ? [...list] : [];
}

/** Short line under the state <select> when subdivisions exist. */
export function registrationStateDropdownCaption(country: string): string {
   const c = String(country || "").trim();
   if (!c) return "";
   return `Official states, provinces, or regions for ${c}.`;
}
