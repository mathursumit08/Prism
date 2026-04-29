import { pool } from "../db.js";

export const permissions = {
  viewForecast: "View Forecast",
  manageForecast: "Manage Forecast"
};

export function buildUserProfile(user) {
  const grantedPermissions = (user.permissions || []).filter(Boolean);
  const role = user.role_name || "";
  const canViewForecast = grantedPermissions.includes(permissions.viewForecast);
  const canManageForecast = grantedPermissions.includes(permissions.manageForecast);
  const forecastLevels =
    role === "Dealer Manager"
      ? ["dealer"]
      : canViewForecast
        ? ["zone", "state", "dealer"]
        : [];

  return {
    username: user.username,
    name: user.employee_name,
    role,
    jobTitle: user.job_title,
    permissions: grantedPermissions,
    region: user.region,
    dealerId: user.dealer_id,
    isActive: user.is_active,
    lastLogoutAt: user.last_logout_at,
    forecastLevels
  };
}

export function getScope(profile) {
  if (profile.role === "Regional Head") {
    return {
      kind: "region",
      region: profile.region
    };
  }

  if (profile.role === "Dealer Manager") {
    return {
      kind: "dealer",
      dealerId: profile.dealerId
    };
  }

  return {
    kind: "all"
  };
}

export function canAccessForecastLevel(profile, level) {
  if (!level) {
    return true;
  }

  return profile.forecastLevels.includes(level);
}

export async function isGroupAllowed(profile, level, groupId) {
  if (!groupId) {
    return true;
  }

  if (profile.role === "Regional Head") {
    if (level === "zone") {
      return groupId === profile.region;
    }

    if (level === "state") {
      const result = await pool.query(
        `
          SELECT 1
          FROM dealers
          WHERE state = $1
            AND region = $2
          LIMIT 1
        `,
        [groupId, profile.region]
      );

      return result.rowCount > 0;
    }

    if (level === "dealer") {
      const result = await pool.query(
        `
          SELECT 1
          FROM dealers
          WHERE dealer_id = $1
            AND region = $2
          LIMIT 1
        `,
        [groupId, profile.region]
      );

      return result.rowCount > 0;
    }
  }

  if (profile.role === "Dealer Manager") {
    return level === "dealer" && groupId === profile.dealerId;
  }

  return true;
}
