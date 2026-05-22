import { useEffect, useMemo, useState } from "react";
import Forecast, { defaultDashboardCardVisibility } from "./pages/Forecast.jsx";
import DomainForecast from "./pages/DomainForecast.jsx";
import ManageForecast from "./pages/ManageForecast.jsx";
import ForecastEvents from "./pages/ForecastEvents.jsx";
import DashboardCards from "./pages/DashboardCards.jsx";
import LoginPage from "./pages/Login.jsx";
import { useAuth } from "./auth/AuthContext.jsx";

function resolvePageFromHash(hash) {
  if (
    hash === "#forecast" ||
    hash === "#forecast-diagnostics" ||
    hash === "#forecast-leaderboard" ||
    hash === "#forecast-tables"
  ) {
    return "home";
  }

  if (hash === "#admin") {
    return "admin";
  }

  if (hash === "#parts-dashboard") {
    return "parts-dashboard";
  }

  if (
    hash === "#parts-dashboard-diagnostics" ||
    hash === "#parts-dashboard-leaderboard" ||
    hash === "#parts-dashboard-data"
  ) {
    return "parts-dashboard";
  }

  if (hash === "#service-dashboard") {
    return "service-dashboard";
  }

  if (
    hash === "#service-dashboard-diagnostics" ||
    hash === "#service-dashboard-leaderboard" ||
    hash === "#service-dashboard-data"
  ) {
    return "service-dashboard";
  }

  if (hash === "#parts-forecast-admin") {
    return "parts-forecast-admin";
  }

  if (hash === "#service-forecast-admin") {
    return "service-forecast-admin";
  }

  if (hash === "#forecast-events") {
    return "forecast-events";
  }

  if (hash === "#dashboard-cards") {
    return "dashboard-cards";
  }

  return "home";
}

const forecastNavDefinitions = [
  // Each dashboard side-menu item owns a group of cards. When an admin hides every
  // card in a group, the menu item is hidden as well.
  { hash: "#forecast", label: "Forecast Monitor", cards: ["trend", "segmentSplit", "forecastGraph", "regionalSegmentSplit"] },
  { hash: "#forecast-diagnostics", label: "Diagnostics", cards: ["accuracyTrend", "biasTrend", "actualPredicted", "errorDistribution"] },
  { hash: "#forecast-leaderboard", label: "Leaderboard", cards: ["leaderboard"] },
  { hash: "#forecast-tables", label: "Forecast Data", cards: ["segmentBreakdown", "forecastData"] }
];

const partsNavDefinitions = [
  { hash: "#parts-dashboard", label: "Monitor", cards: ["trend", "segmentSplit", "forecastGraph", "regionalSegmentSplit"] },
  { hash: "#parts-dashboard-diagnostics", label: "Diagnostics", cards: ["accuracyTrend", "biasTrend", "actualPredicted", "errorDistribution"] },
  { hash: "#parts-dashboard-leaderboard", label: "Leaderboard", cards: ["leaderboard"] },
  { hash: "#parts-dashboard-data", label: "Forecast Data", cards: ["segmentBreakdown", "forecastData"] }
];

const serviceNavDefinitions = [
  { hash: "#service-dashboard", label: "Monitor", cards: ["trend", "segmentSplit", "forecastGraph", "regionalSegmentSplit"] },
  { hash: "#service-dashboard-diagnostics", label: "Diagnostics", cards: ["accuracyTrend", "biasTrend", "actualPredicted", "errorDistribution"] },
  { hash: "#service-dashboard-leaderboard", label: "Leaderboard", cards: ["leaderboard"] },
  { hash: "#service-dashboard-data", label: "Forecast Data", cards: ["segmentBreakdown", "forecastData"] }
];

function createDefaultDashboardCardVisibilityByDomain() {
  return {
    Sales: { ...defaultDashboardCardVisibility },
    Parts: { ...defaultDashboardCardVisibility },
    Service: { ...defaultDashboardCardVisibility }
  };
}

function buildDashboardCardVisibilityByDomain(cards) {
  return cards.reduce((visibilityByDomain, card) => {
    const domain = card.domain || "Sales";
    if (!visibilityByDomain[domain]) {
      visibilityByDomain[domain] = { ...defaultDashboardCardVisibility };
    }
    visibilityByDomain[domain][card.key] = Boolean(card.enabled);
    return visibilityByDomain;
  }, createDefaultDashboardCardVisibilityByDomain());
}

function filterVisibleNavItems(definitions, visibility) {
  return definitions.filter((item) => item.cards.some((cardKey) => visibility[cardKey]));
}

function hasDomainScope(user, domain) {
  return (user?.accessScopes || []).some((scope) => scope.domain === domain);
}

function HomePage({ user }) {
  const hasPermissions = (user.permissions || []).length > 0;

  return (
    <section className="home-workspace">
      <header className="home-workspace-header">
        <div>
          <p className="eyebrow">Prism Workspace</p>
          <h1>Welcome, {user.name}</h1>
          <p>
            {hasPermissions
              ? "Your workspace is ready for the permissions assigned to your account."
              : "Your account is active, but no application permissions have been assigned yet."}
          </p>
        </div>
        <div className="home-role-panel">
          <span>Signed in as</span>
          <strong>{user.role}</strong>
        </div>
      </header>

      <section className="home-summary-grid" aria-label="Workspace summary">
        <article className="metric">
          <span>Access level</span>
          <strong>{user.role}</strong>
          <p>Role-based permissions are applied from your account profile.</p>
        </article>
        <article className="metric">
          <span>Assigned permissions</span>
          <strong>{user.permissions?.length || 0}</strong>
          <p>Menu items appear automatically when permissions and access scopes are assigned.</p>
        </article>
        <article className="metric">
          <span>Workspace status</span>
          <strong>Active</strong>
          <p>Your secure session is ready.</p>
        </article>
      </section>

      <section className="home-panel-grid" aria-label="Workspace guidance">
        <article className="home-panel">
          <p className="eyebrow">Next steps</p>
          <h2>{hasPermissions ? "Use the available navigation for assigned work." : "Ask an administrator to assign access."}</h2>
          <p>
            Forecast dashboards and administrative controls are available only when your role has the required permissions and data scope.
          </p>
        </article>
        <article className="home-panel">
          <p className="eyebrow">Access</p>
          <h2>Need additional permissions?</h2>
          <p>
            Ask your manager or Prism administrator to review your role, permissions, and access scopes.
          </p>
        </article>
      </section>
    </section>
  );
}

export default function App() {
  const { apiFetch, booting, isAuthenticated, logout, user } = useAuth();
  const [page, setPage] = useState(() => resolvePageFromHash(window.location.hash));
  const [currentHash, setCurrentHash] = useState(() => window.location.hash || "#forecast");
  const [dashboardCardVisibilityByDomain, setDashboardCardVisibilityByDomain] = useState(createDefaultDashboardCardVisibilityByDomain);
  const canViewForecast = user?.permissions?.includes("View Forecast");
  const canViewPartsForecast = user?.permissions?.includes("View Parts Forecast");
  const canViewServiceForecast = user?.permissions?.includes("View Service Forecast");
  const canManageForecast = user?.permissions?.includes("Manage Forecast");
  const canManagePartsForecast = user?.permissions?.includes("Manage Parts Forecast");
  const canManageServiceForecast = user?.permissions?.includes("Manage Service Forecast");
  const canManageAnyForecast = Boolean(canManageForecast || canManagePartsForecast || canManageServiceForecast);
  const hasAnyPermission = Boolean(user?.permissions?.length);
  const isAdmin = user?.role === "Admin";
  const isServiceManager = user?.role === "Service Manager";
  const isPartsManager = user?.role === "Parts Manager";
  const hasSalesScope = hasDomainScope(user, "Sales");
  const hasPartsScope = hasDomainScope(user, "Parts");
  const hasServiceScope = hasDomainScope(user, "Service");
  const canAccessSalesDashboard = Boolean(canViewForecast && hasSalesScope);
  const canAccessPartsDashboard = Boolean(canViewPartsForecast && hasPartsScope);
  const canAccessServiceDashboard = Boolean(canViewServiceForecast && hasServiceScope);
  const usesForecastHome = Boolean(user && canAccessSalesDashboard);
  const visibleForecastNavItems = useMemo(
    () =>
      usesForecastHome
        ? filterVisibleNavItems(forecastNavDefinitions, dashboardCardVisibilityByDomain.Sales)
        : [],
    [dashboardCardVisibilityByDomain, usesForecastHome]
  );
  const visiblePartsNavItems = useMemo(
    () => (canAccessPartsDashboard ? filterVisibleNavItems(partsNavDefinitions, dashboardCardVisibilityByDomain.Parts) : []),
    [canAccessPartsDashboard, dashboardCardVisibilityByDomain]
  );
  const visibleServiceNavItems = useMemo(
    () => (canAccessServiceDashboard ? filterVisibleNavItems(serviceNavDefinitions, dashboardCardVisibilityByDomain.Service) : []),
    [canAccessServiceDashboard, dashboardCardVisibilityByDomain]
  );
  const canUseForecastDashboard = usesForecastHome && visibleForecastNavItems.length > 0;
  const fallbackPage = isPartsManager && canAccessPartsDashboard
    ? "parts-dashboard"
    : isServiceManager && canAccessServiceDashboard
      ? "service-dashboard"
      : canUseForecastDashboard
        ? "home"
        : canAccessServiceDashboard
          ? "service-dashboard"
          : canAccessPartsDashboard
            ? "parts-dashboard"
            : "home";

  useEffect(() => {
    function handleHashChange() {
      const nextHash = window.location.hash || "#forecast";
      setCurrentHash(nextHash);
      setPage(resolvePageFromHash(nextHash));
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || (!canAccessSalesDashboard && !canAccessPartsDashboard && !canAccessServiceDashboard)) {
      setDashboardCardVisibilityByDomain(createDefaultDashboardCardVisibilityByDomain());
      return undefined;
    }

    const controller = new AbortController();

    async function loadDashboardCardVisibility() {
      // The shell needs the same visibility map as ForecastPage so the sidebar
      // can disappear sections that have no visible cards left.
      try {
        const response = await apiFetch("/api/v1/forecasts/dashboard-cards", {
          signal: controller.signal
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load dashboard card settings.");
        }

        setDashboardCardVisibilityByDomain(buildDashboardCardVisibilityByDomain(payload.cards || []));
      } catch (error) {
        if (error.name !== "AbortError") {
          setDashboardCardVisibilityByDomain(createDefaultDashboardCardVisibilityByDomain());
        }
      }
    }

    loadDashboardCardVisibility();
    window.addEventListener("dashboard-card-settings-changed", loadDashboardCardVisibility);

    return () => {
      controller.abort();
      window.removeEventListener("dashboard-card-settings-changed", loadDashboardCardVisibility);
    };
  }, [apiFetch, canAccessSalesDashboard, canAccessPartsDashboard, canAccessServiceDashboard, isAuthenticated]);

  function navigate(nextPage) {
    const hashByPage = {
      admin: "admin",
      "parts-dashboard": "parts-dashboard",
      "service-dashboard": "service-dashboard",
      "parts-forecast-admin": "parts-forecast-admin",
      "service-forecast-admin": "service-forecast-admin",
      "forecast-events": "forecast-events",
      "dashboard-cards": "dashboard-cards",
      home: "home"
    };

    window.location.hash = hashByPage[nextPage] || "home";
    setPage(nextPage);
  }

  useEffect(() => {
    if (!isAuthenticated || !user) {
      return;
    }

    if (!hasAnyPermission && (page !== "home" || currentHash !== "#home")) {
      navigate("home");
      return;
    }

    if (page === "home" && !canUseForecastDashboard && fallbackPage !== "home") {
      navigate(fallbackPage);
      return;
    }

    if (page === "admin" && !canManageForecast) {
      navigate(fallbackPage);
      return;
    }

    if (page === "forecast-events" && !canManageAnyForecast) {
      navigate(fallbackPage);
      return;
    }

    if (page === "parts-dashboard" && !canAccessPartsDashboard) {
      navigate(fallbackPage);
      return;
    }

    if (page === "service-dashboard" && !canAccessServiceDashboard) {
      navigate(fallbackPage);
      return;
    }

    if (page === "parts-forecast-admin" && !canManagePartsForecast) {
      navigate(fallbackPage);
      return;
    }

    if (page === "service-forecast-admin" && !canManageServiceForecast) {
      navigate(fallbackPage);
      return;
    }

    if (page === "dashboard-cards" && !isAdmin) {
      navigate(fallbackPage);
      return;
    }

    if (page === "home" && usesForecastHome) {
      const currentForecastItem = forecastNavDefinitions.find((item) => item.hash === currentHash);
      const currentForecastItemVisible = visibleForecastNavItems.some((item) => item.hash === currentHash);

      // If an admin hides the section the user is currently viewing, move them to
      // the first remaining section instead of leaving the content area empty.
      if (currentForecastItem && !currentForecastItemVisible) {
        window.location.hash = visibleForecastNavItems[0]?.hash || "#home";
      }
    }

    if (page === "parts-dashboard") {
      const currentPartsItem = partsNavDefinitions.find((item) => item.hash === currentHash);
      const currentPartsItemVisible = visiblePartsNavItems.some((item) => item.hash === currentHash);
      if (currentPartsItem && !currentPartsItemVisible) {
        window.location.hash = visiblePartsNavItems[0]?.hash || "#home";
      }
    }

    if (page === "service-dashboard") {
      const currentServiceItem = serviceNavDefinitions.find((item) => item.hash === currentHash);
      const currentServiceItemVisible = visibleServiceNavItems.some((item) => item.hash === currentHash);
      if (currentServiceItem && !currentServiceItemVisible) {
        window.location.hash = visibleServiceNavItems[0]?.hash || "#home";
      }
    }
  }, [canAccessPartsDashboard, canAccessServiceDashboard, canManageAnyForecast, canManageForecast, canManagePartsForecast, canManageServiceForecast, currentHash, fallbackPage, hasAnyPermission, isAdmin, isAuthenticated, page, user, usesForecastHome, visibleForecastNavItems, visiblePartsNavItems, visibleServiceNavItems]);

  if (booting) {
    return (
      <main className="auth-shell">
        <section className="login-card login-card-boot">
          <p className="eyebrow">Prism Access</p>
          <h1>Restoring your secure session.</h1>
        </section>
      </main>
    );
  }

  if (!isAuthenticated || !user) {
    return <LoginPage />;
  }

  const forecastNavItems = canUseForecastDashboard ? visibleForecastNavItems : [];
  const partsNavItems = visiblePartsNavItems;
  const serviceNavItems = visibleServiceNavItems;
  const manageNavItems = [
    ...(canManageForecast ? [{ hash: "#admin", label: "Manage Forecast" }] : []),
    ...(canManagePartsForecast ? [{ hash: "#parts-forecast-admin", label: "Parts Forecast" }] : []),
    ...(canManageServiceForecast ? [{ hash: "#service-forecast-admin", label: "Service Forecast" }] : []),
    ...(canManageAnyForecast ? [{ hash: "#forecast-events", label: "Forecast Events" }] : []),
    ...(isAdmin ? [{ hash: "#dashboard-cards", label: "Dashboard Cards" }] : [])
  ];
  return (
    <main className="app-shell">
      <aside className="app-sidebar" aria-label="Primary navigation">
        <div className="app-sidebar-brand">
          <img
            src="/resources/images/prism-sales-forecasting-logo.png"
            alt="PRISM Sales Forecasting"
          />
        </div>
        <div className="app-sidebar-top">
          <nav className="app-sidebar-nav">
            {forecastNavItems.length > 0 && (
              <>
                <p>Sales Dashboard</p>
                {forecastNavItems.map((item) => (
                  <a
                    key={item.hash}
                    className={
                      currentHash === item.hash || (!currentHash && item.hash === "#home")
                        ? "active"
                        : ""
                    }
                    href={item.hash}
                    onClick={() => {
                      setCurrentHash(item.hash);
                      setPage(resolvePageFromHash(item.hash));
                    }}
                  >
                    {item.label}
                  </a>
                ))}
              </>
            )}

            {serviceNavItems.length > 0 && (
              <>
                <p>Service Dashboard</p>
                {serviceNavItems.map((item) => (
                  <a
                    key={item.hash}
                    className={currentHash === item.hash || (!currentHash && item.hash === "#service-dashboard") ? "active" : ""}
                    href={item.hash}
                    onClick={() => {
                      setCurrentHash(item.hash);
                      setPage(resolvePageFromHash(item.hash));
                    }}
                  >
                    {item.label}
                  </a>
                ))}
              </>
            )}

            {partsNavItems.length > 0 && (
              <>
                <p>Parts Dashboard</p>
                {partsNavItems.map((item) => (
                  <a
                    key={item.hash}
                    className={currentHash === item.hash || (!currentHash && item.hash === "#parts-dashboard") ? "active" : ""}
                    href={item.hash}
                    onClick={() => {
                      setCurrentHash(item.hash);
                      setPage(resolvePageFromHash(item.hash));
                    }}
                  >
                    {item.label}
                  </a>
                ))}
              </>
            )}

            {manageNavItems.length > 0 && (
              <>
                <p>Manage</p>
                {manageNavItems.map((item) => (
                  <a
                    key={item.hash}
                    className={currentHash === item.hash ? "active" : ""}
                    href={item.hash}
                    onClick={() => {
                      setCurrentHash(item.hash);
                      setPage(resolvePageFromHash(item.hash));
                    }}
                  >
                    {item.label}
                  </a>
                ))}
              </>
            )}
          </nav>
        </div>

        <div className="app-sidebar-bottom">
          <div className="app-user-card">
            <div>
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </div>
            <button type="button" className="secondary-button nav-logout icon-logout" onClick={logout} aria-label="Logout" title="Logout">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v9" />
                <path d="M7.05 7.05a7 7 0 1 0 9.9 0" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <div className="app-content">
        {page === "home" && canUseForecastDashboard ? (
          <Forecast />
        ) : page === "parts-dashboard" && canAccessPartsDashboard ? (
          <DomainForecast key="parts-dashboard" domain="parts" />
        ) : page === "service-dashboard" && canAccessServiceDashboard ? (
          <DomainForecast key="service-dashboard" domain="service" />
        ) : page === "admin" && canManageForecast ? (
          <ManageForecast />
        ) : page === "parts-forecast-admin" && canManagePartsForecast ? (
          <ManageForecast
            domain="parts"
            eyebrow="Parts Forecast Administration"
            title="Manage service parts demand forecasting."
            description="Review parts run health, clear future output, and launch a Croston-style demand forecast regeneration."
            regenerateLabel="Regenerate parts forecast"
            clearLabel="Clear future parts forecast rows"
          />
        ) : page === "service-forecast-admin" && canManageServiceForecast ? (
          <ManageForecast
            domain="service"
            eyebrow="Service Forecast Administration"
            title="Manage service order volume forecasting."
            description="Review service run health, clear future output, and launch order-volume forecast regeneration for capacity planning."
            regenerateLabel="Regenerate service forecast"
            clearLabel="Clear future service forecast rows"
          />
        ) : page === "forecast-events" && canManageAnyForecast ? (
          <ForecastEvents />
        ) : page === "dashboard-cards" && isAdmin ? (
          <DashboardCards />
        ) : (
          <HomePage user={user} />
        )}
      </div>
    </main>
  );
}
