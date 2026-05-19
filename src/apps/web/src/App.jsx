import { useEffect, useMemo, useState } from "react";
import Forecast, { buildDashboardCardVisibility, defaultDashboardCardVisibility } from "./pages/Forecast.jsx";
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

function HomePage({ user }) {
  return (
    <section className="home-workspace">
      <header className="home-workspace-header">
        <div>
          <p className="eyebrow">Prism Sales Planning</p>
          <h1>Welcome, {user.name}</h1>
          <p>Your current access is configured for the sales execution workspace.</p>
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
          <span>Forecast access</span>
          <strong>{user.permissions?.includes("View Forecast") ? "Enabled" : "Restricted"}</strong>
          <p>Contact your administrator if your planning responsibilities require forecast views.</p>
        </article>
        <article className="metric">
          <span>Workspace status</span>
          <strong>Active</strong>
          <p>Your secure session is ready for assigned sales planning tasks.</p>
        </article>
      </section>

      <section className="home-panel-grid" aria-label="Sales executive workspace">
        <article className="home-panel">
          <p className="eyebrow">Next steps</p>
          <h2>Use your assigned sales systems for execution updates.</h2>
          <p>
            Forecast dashboards and administrative controls are available only to roles with planning or management access.
          </p>
        </article>
        <article className="home-panel">
          <p className="eyebrow">Support</p>
          <h2>Need forecast access?</h2>
          <p>
            Ask your manager or Prism administrator to review your role and permissions.
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
  const [dashboardCardVisibility, setDashboardCardVisibility] = useState({ ...defaultDashboardCardVisibility });
  const canViewForecast = user?.permissions?.includes("View Forecast");
  const canManageForecast = user?.permissions?.includes("Manage Forecast");
  const isAdmin = user?.role === "Admin";
  const forecastHomeRoles = new Set(["Admin", "National Head", "Regional Head", "Dealer Head", "Dealer Manager"]);
  const usesForecastHome = Boolean(user && forecastHomeRoles.has(user.role) && canViewForecast);
  const visibleForecastNavItems = useMemo(
    () =>
      usesForecastHome
        ? forecastNavDefinitions.filter((item) => item.cards.some((cardKey) => dashboardCardVisibility[cardKey]))
        : [],
    [dashboardCardVisibility, usesForecastHome]
  );
  const canUseForecastDashboard = usesForecastHome && visibleForecastNavItems.length > 0;

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
    if (!isAuthenticated || !canViewForecast) {
      setDashboardCardVisibility({ ...defaultDashboardCardVisibility });
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

        setDashboardCardVisibility(buildDashboardCardVisibility(payload.cards || []));
      } catch (error) {
        if (error.name !== "AbortError") {
          setDashboardCardVisibility({ ...defaultDashboardCardVisibility });
        }
      }
    }

    loadDashboardCardVisibility();
    window.addEventListener("dashboard-card-settings-changed", loadDashboardCardVisibility);

    return () => {
      controller.abort();
      window.removeEventListener("dashboard-card-settings-changed", loadDashboardCardVisibility);
    };
  }, [apiFetch, canViewForecast, isAuthenticated]);

  function navigate(nextPage) {
    window.location.hash =
      nextPage === "admin"
          ? "admin"
          : nextPage === "forecast-events"
            ? "forecast-events"
            : nextPage === "dashboard-cards"
              ? "dashboard-cards"
              : "home";
    setPage(nextPage);
  }

  useEffect(() => {
    if (!isAuthenticated || !user) {
      return;
    }

    if ((page === "admin" || page === "forecast-events") && !canManageForecast) {
      navigate("home");
    }

    if (page === "dashboard-cards" && !isAdmin) {
      navigate("home");
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
  }, [canManageForecast, canViewForecast, currentHash, isAdmin, isAuthenticated, page, user, usesForecastHome, visibleForecastNavItems]);

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

  const forecastNavItems = canUseForecastDashboard ? visibleForecastNavItems : [{ hash: "#home", label: "Home" }];
  const manageNavItems = [
    ...(canManageForecast ? [{ hash: "#admin", label: "Manage Forecast" }] : []),
    ...(canManageForecast ? [{ hash: "#forecast-events", label: "Forecast Events" }] : []),
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
            <p>Dashboard</p>
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
        ) : page === "admin" && canManageForecast ? (
          <ManageForecast />
        ) : page === "forecast-events" && canManageForecast ? (
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
