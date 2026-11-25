/**
 * Cost combines OpenCode's recorded total with API list-price estimates for the
 * messages Bastion has loaded. The host can replace that window, and its ledger
 * also counts usage without a message, so the value is never a lifetime claim.
 * An unversioned alias can only be priced from today's listing, not the tariff
 * in effect when a historical request ran.
 */
export const COST_EXPLANATION =
  "Recorded cost plus API list-price estimates for loaded messages. Loaded history may be incomplete, and unversioned aliases use their current listed tariff.";
