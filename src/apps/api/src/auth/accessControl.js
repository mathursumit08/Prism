import { pool } from "../db.js";

export const permissions = {
  viewForecast: "View Forecast",
  manageForecast: "Manage Forecast",
  viewPartsForecast: "View Parts Forecast",
  managePartsForecast: "Manage Parts Forecast",
  viewServiceForecast: "View Service Forecast",
  manageServiceForecast: "Manage Service Forecast",
  viewWarrantyForecast: "View Warranty Forecast",
  manageWarrantyForecast: "Manage Warranty Forecast",
  viewSlaForecast: "View SLA Forecast",
  manageSlaForecast: "Manage SLA Forecast",
  viewCustomerServiceTranscripts: "View Customer Service Transcripts",
  manageCustomerServiceTranscripts: "Manage Customer Service Transcripts",
  analyzeCustomerServiceTranscripts: "Analyze Customer Service Transcripts"
};

const domains = ["Sales", "Parts", "Service", "Warranty", "SLA", "Customer Service"];

export function normalizeAccessDomain(domain = "Sales") {
  const normalized = String(domain || "").trim().toLowerCase();
  if (normalized === "parts") return "Parts";
  if (normalized === "service") return "Service";
  if (normalized === "warranty") return "Warranty";
  if (normalized === "sla") return "SLA";
  if (normalized === "customer_service" || normalized === "customer service") return "Customer Service";
  return "Sales";
}

function normalizeScopeType(type) {
  const normalized = String(type || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "service_center") return "Service Center";
  if (normalized === "dealer") return "Dealer";
  if (normalized === "region") return "Region";
  if (normalized === "national") return "National";
  return type;
}

function normalizeScope(row) {
  return {
    domain: normalizeAccessDomain(row.domain),
    type: normalizeScopeType(row.scope_type || row.type),
    value: row.scope_value ?? row.value ?? null
  };
}

function scopesForDomain(profile, domain) {
  const accessDomain = normalizeAccessDomain(domain);
  return (profile.accessScopes || []).filter((scope) => scope.domain === accessDomain);
}

function hasPermission(profile, permission) {
  return (profile.permissions || []).includes(permission);
}

function hasNationalScope(scopes) {
  return scopes.some((scope) => scope.type === "National");
}

function valuesForType(scopes, type) {
  return [...new Set(scopes.filter((scope) => scope.type === type && scope.value).map((scope) => scope.value))];
}

function firstValueForType(scopes, type) {
  return valuesForType(scopes, type)[0] || null;
}

function inferForecastLevels(profile) {
  if (!hasPermission(profile, permissions.viewForecast)) {
    return [];
  }

  const salesScopes = scopesForDomain(profile, "Sales");
  if (salesScopes.length === 0) {
    return [];
  }

  if (hasNationalScope(salesScopes) || salesScopes.some((scope) => scope.type === "Region")) {
    return ["zone", "state", "dealer"];
  }

  if (salesScopes.some((scope) => scope.type === "Dealer")) {
    return ["dealer"];
  }

  return ["zone", "state", "dealer"];
}

export function buildUserProfile(user) {
  const grantedPermissions = (user.permissions || []).filter(Boolean);
  const role = user.role_name || "";
  const accessScopes = (user.access_scopes || []).map(normalizeScope);
  const profile = {
    username: user.username,
    name: user.employee_name,
    role,
    jobTitle: user.job_title,
    permissions: grantedPermissions,
    accessScopes,
    isActive: user.is_active,
    lastLogoutAt: user.last_logout_at
  };

  return {
    ...profile,
    region: firstValueForType(accessScopes, "Region"),
    dealerId: firstValueForType(scopesForDomain(profile, "Sales"), "Dealer"),
    serviceCenterId:
      firstValueForType(scopesForDomain(profile, "Parts"), "Service Center") ||
      firstValueForType(scopesForDomain(profile, "Service"), "Service Center") ||
      firstValueForType(scopesForDomain(profile, "Warranty"), "Service Center") ||
      firstValueForType(scopesForDomain(profile, "SLA"), "Service Center") ||
      firstValueForType(scopesForDomain(profile, "Customer Service"), "Service Center"),
    forecastLevels: inferForecastLevels(profile)
  };
}

export function getScopesForDomain(profile, domain = "Sales") {
  const scopes = scopesForDomain(profile, domain);
  if (scopes.length > 0) {
    return scopes;
  }

  return [];
}

export function getScope(profile, domain = "Sales") {
  const accessDomain = normalizeAccessDomain(domain);
  const scopes = getScopesForDomain(profile, accessDomain);
  if (scopes.length === 0) {
    return {
      kind: "none",
      domain: accessDomain,
      scopes
    };
  }

  if (hasNationalScope(scopes)) {
    return {
      kind: "all",
      domain: accessDomain,
      scopes
    };
  }

  const regionValues = valuesForType(scopes, "Region");
  const dealerValues = valuesForType(scopes, "Dealer");
  const serviceCenterValues = valuesForType(scopes, "Service Center");

  if (scopes.length === 1 && regionValues.length === 1) {
    return { kind: "Region", domain: accessDomain, region: regionValues[0], scopes };
  }

  if (scopes.length === 1 && dealerValues.length === 1) {
    return { kind: "Dealer", domain: accessDomain, dealerId: dealerValues[0], scopes };
  }

  if (scopes.length === 1 && serviceCenterValues.length === 1) {
    return { kind: "Service Center", domain: accessDomain, serviceCenterId: serviceCenterValues[0], scopes };
  }

  return {
    kind: "multi",
    domain: accessDomain,
    scopes,
    regions: regionValues,
    dealerIds: dealerValues,
    serviceCenterIds: serviceCenterValues
  };
}

export function canAccessForecastLevel(profile, level) {
  if (!level) {
    return true;
  }

  return profile.forecastLevels.includes(level);
}

function scopeAllowsZone(scope, groupId) {
  return scope.type === "National" || (scope.type === "Region" && scope.value === groupId);
}

async function scopeAllowsState(scope, state) {
  if (scope.type === "National") return true;
  if (scope.type === "Region") {
    const result = await pool.query(
      `
        SELECT 1
        FROM dealers
        WHERE state = $1
          AND region = $2
          AND is_active = TRUE
        LIMIT 1
      `,
      [state, scope.value]
    );
    return result.rowCount > 0;
  }
  if (scope.type === "Dealer") {
    const result = await pool.query(
      `
        SELECT 1
        FROM dealers
        WHERE dealer_id = $1
          AND state = $2
          AND is_active = TRUE
        LIMIT 1
      `,
      [scope.value, state]
    );
    return result.rowCount > 0;
  }
  return false;
}

async function scopeAllowsDealer(scope, dealerId) {
  if (scope.type === "National") return true;
  if (scope.type === "Dealer") return scope.value === dealerId;
  if (scope.type === "Region") {
    const result = await pool.query(
      `
        SELECT 1
        FROM dealers
        WHERE dealer_id = $1
          AND region = $2
          AND is_active = TRUE
        LIMIT 1
      `,
      [dealerId, scope.value]
    );
    return result.rowCount > 0;
  }
  return false;
}

export async function isGroupAllowed(profile, level, groupId) {
  if (!groupId) {
    return true;
  }

  const salesScopes = getScopesForDomain(profile, "Sales");
  if (salesScopes.length === 0) {
    return false;
  }

  for (const scope of salesScopes) {
    if (level === "zone" && scopeAllowsZone(scope, groupId)) return true;
    if (level === "state" && (await scopeAllowsState(scope, groupId))) return true;
    if (level === "dealer" && (await scopeAllowsDealer(scope, groupId))) return true;
  }

  return false;
}

export function domainForPermission(permission) {
  if (permission === permissions.viewForecast || permission === permissions.manageForecast) return "Sales";
  if (permission === permissions.viewPartsForecast || permission === permissions.managePartsForecast) return "Parts";
  if (permission === permissions.viewServiceForecast || permission === permissions.manageServiceForecast) return "Service";
  if (permission === permissions.viewWarrantyForecast || permission === permissions.manageWarrantyForecast) return "Warranty";
  if (permission === permissions.viewSlaForecast || permission === permissions.manageSlaForecast) return "SLA";
  if (
    permission === permissions.viewCustomerServiceTranscripts ||
    permission === permissions.manageCustomerServiceTranscripts ||
    permission === permissions.analyzeCustomerServiceTranscripts
  ) return "Customer Service";
  return domains[0];
}
