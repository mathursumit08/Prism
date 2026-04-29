import { useEffect, useState } from "react";
import Forecast from "./pages/Forecast.jsx";
import Admin from "./pages/Admin.jsx";
import LoginPage from "./pages/Login.jsx";
import { useAuth } from "./auth/AuthContext.jsx";

function resolvePageFromHash(hash) {
  if (hash === "#forecast") {
    return "forecast";
  }

  if (hash === "#admin") {
    return "admin";
  }

  return "home";
}

function HomePage({ onPrimaryAction, user }) {
  const canViewForecast = user.permissions.includes("View Forecast");

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
        <button type="button" onClick={onPrimaryAction}>
          {canViewForecast ? "Open forecast" : "Stay on home"}
        </button>
      </div>
      <img
        src="https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=900&q=80"
        alt="Sales planning workspace"
      />
    </section>
  );
}

export default function App() {
  const { booting, isAuthenticated, logout, user } = useAuth();
  const [page, setPage] = useState(() => resolvePageFromHash(window.location.hash));
  const canViewForecast = user?.permissions?.includes("View Forecast");
  const canManageForecast = user?.permissions?.includes("Manage Forecast");

  useEffect(() => {
    function handleHashChange() {
      setPage(resolvePageFromHash(window.location.hash));
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function navigate(nextPage) {
    window.location.hash = nextPage === "forecast" ? "forecast" : nextPage === "admin" ? "admin" : "home";
    setPage(nextPage);
  }

  useEffect(() => {
    if (!isAuthenticated || !user) {
      return;
    }

    if (page === "forecast" && !canViewForecast) {
      navigate("home");
    }

    if (page === "admin" && !canManageForecast) {
      navigate("home");
    }
  }, [canManageForecast, canViewForecast, isAuthenticated, page, user]);

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
        {canViewForecast && (
          <a className={page === "forecast" ? "active" : ""} href="#forecast" onClick={() => navigate("forecast")}>
            Forecast
          </a>
        )}
        {canManageForecast && (
          <a className={page === "admin" ? "active" : ""} href="#admin" onClick={() => navigate("admin")}>
            Admin
          </a>
        )}
        <div className="nav-spacer" />
        <span className="nav-user">
          {user.name} · {user.role}
        </span>
        <button type="button" className="secondary-button nav-logout" onClick={logout}>
          Logout
        </button>
      </nav>

      {page === "forecast" && canViewForecast ? (
        <Forecast />
      ) : page === "admin" && canManageForecast ? (
        <Admin />
      ) : (
        <HomePage onPrimaryAction={() => navigate(canViewForecast ? "forecast" : "home")} user={user} />
      )}
    </main>
  );
}
