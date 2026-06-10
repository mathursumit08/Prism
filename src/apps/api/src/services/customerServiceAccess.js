import { getScopesForDomain } from "../auth/accessControl.js";

const serviceDomains = ["Customer Service", "Service", "Parts", "Warranty", "SLA"];

function hasNationalScope(scopes) {
  return scopes.some((scope) => scope.type === "National");
}

function valuesForType(scopes, type) {
  return [...new Set(scopes.filter((scope) => scope.type === type && scope.value).map((scope) => scope.value))];
}

export function getCustomerServiceScopes(user) {
  const combined = [];
  for (const domain of serviceDomains) {
    combined.push(...getScopesForDomain(user, domain));
  }

  return combined;
}

export function buildCustomerServiceScopeFilter(user, values, alias = "cst") {
  const scopes = getCustomerServiceScopes(user);
  if (scopes.length === 0) {
    return "FALSE";
  }

  if (hasNationalScope(scopes)) {
    return "TRUE";
  }

  const clauses = [];
  const regions = valuesForType(scopes, "Region");
  const serviceCenters = valuesForType(scopes, "Service Center");
  const dealers = valuesForType(scopes, "Dealer");

  if (regions.length > 0) {
    values.push(regions);
    clauses.push(`(
      ${alias}.dealer_id IN (SELECT dealer_id FROM dealers WHERE region = ANY($${values.length}) AND is_active = TRUE)
      OR ${alias}.service_center_id IN (SELECT service_center_id FROM service_centers WHERE region = ANY($${values.length}) AND is_active = TRUE)
    )`);
  }

  if (serviceCenters.length > 0) {
    values.push(serviceCenters);
    clauses.push(`${alias}.service_center_id = ANY($${values.length})`);
  }

  if (dealers.length > 0) {
    values.push(dealers);
    clauses.push(`${alias}.dealer_id = ANY($${values.length})`);
  }

  return clauses.length > 0 ? `(${clauses.join(" OR ")})` : "FALSE";
}

export function canCreateTranscriptForOwnership(user, transcript) {
  const values = [];
  const filter = buildCustomerServiceScopeFilter(user, values, "candidate");

  if (filter === "TRUE") {
    return { allowed: true, reason: null };
  }

  if (filter === "FALSE") {
    return { allowed: false, reason: "No customer service access scope is assigned." };
  }

  const scopes = getCustomerServiceScopes(user);
  const regions = valuesForType(scopes, "Region");
  const serviceCenters = valuesForType(scopes, "Service Center");
  const dealers = valuesForType(scopes, "Dealer");

  if (transcript.serviceCenterId && serviceCenters.includes(transcript.serviceCenterId)) {
    return { allowed: true, reason: null };
  }

  if (transcript.dealerId && dealers.includes(transcript.dealerId)) {
    return { allowed: true, reason: null };
  }

  if (regions.length > 0) {
    return { allowed: "region-check", regions };
  }

  return { allowed: false, reason: "Transcript ownership is outside the user's assigned scopes." };
}
