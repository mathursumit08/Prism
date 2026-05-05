import { useEffect, useState } from "react";
import Forecast from "./pages/Forecast.jsx";
import ManageForecast from "./pages/ManageForecast.jsx";
import ForecastEvents from "./pages/ForecastEvents.jsx";
import DashboardCards from "./pages/DashboardCards.jsx";
import LoginPage from "./pages/Login.jsx";
import { useAuth } from "./auth/AuthContext.jsx";

function resolvePageFromHash(hash) {
  if (hash === "#forecast") {
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

function HomePage({ user }) {
  return (
    <section className="home-grid">
      <div className="home-copy">
        <p className="eyebrow">Prism Sales Planning</p>
        <h1>Forecast demand before the month starts.</h1>
        <p>
          Review dealer, state, and zone trends from the latest forecast run, then narrow demand
          by model and variant when the planning question needs more detail.
        </p>
        <p className="home-user-meta">
          Signed in as <strong>{user.name}</strong> · {user.role}
        </p>
      </div>
      <img
        src="/resources/images/sales-planning-workspace.jpg"
        alt="Sales planning workspace"
      />
    </section>
  );
}

export default function App() {
  const { booting, isAuthenticated, logout, user } = useAuth();
  const [page, setPage] = useState(() => resolvePageFromHash(window.location.hash));
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const canViewForecast = user?.permissions?.includes("View Forecast");
  const canManageForecast = user?.permissions?.includes("Manage Forecast");
  const isAdmin = user?.role === "Admin";
  const forecastHomeRoles = new Set(["Admin", "National Head", "Regional Head", "Dealer Head", "Dealer Manager"]);
  const usesForecastHome = Boolean(user && forecastHomeRoles.has(user.role) && canViewForecast);

  useEffect(() => {
    function handleHashChange() {
      setPage(resolvePageFromHash(window.location.hash));
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

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
  }, [canManageForecast, canViewForecast, isAdmin, isAuthenticated, page, user]);

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

  return (
    <main>
      <nav className="top-nav" aria-label="Primary navigation">
        <a className={page === "home" ? "active" : ""} href="#home" onClick={() => navigate("home")}>
          Home
        </a>
        {canManageForecast && (
          <div
            className={`nav-menu ${manageMenuOpen ? "open" : ""}`}
            onMouseEnter={() => setManageMenuOpen(true)}
            onMouseLeave={() => setManageMenuOpen(false)}
          >
            <button
              type="button"
              className={page === "admin" || page === "forecast-events" || page === "dashboard-cards" ? "active nav-menu-button" : "nav-menu-button"}
              onClick={() => setManageMenuOpen((isOpen) => !isOpen)}
              onFocus={() => setManageMenuOpen(true)}
            >
              Manage
            </button>
            <div className="nav-submenu">
              <a
                className={page === "admin" ? "active" : ""}
                href="#admin"
                onClick={() => {
                  setManageMenuOpen(false);
                  navigate("admin");
                }}
              >
                Forecast
              </a>
              <a
                className={page === "forecast-events" ? "active" : ""}
                href="#forecast-events"
                onClick={() => {
                  setManageMenuOpen(false);
                  navigate("forecast-events");
                }}
              >
                Forecast Events
              </a>
              {isAdmin && (
                <a
                  className={page === "dashboard-cards" ? "active" : ""}
                  href="#dashboard-cards"
                  onClick={() => {
                    setManageMenuOpen(false);
                    navigate("dashboard-cards");
                  }}
                >
                  Dashboard Cards
                </a>
              )}
            </div>
          </div>
        )}
        <div className="nav-spacer" />
        <span className="nav-user">
          {user.name} · {user.role}
        </span>
        <button type="button" className="secondary-button nav-logout" onClick={logout}>
          Logout
        </button>
      </nav>

      {page === "home" && usesForecastHome ? (
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
    </main>
  );
}
