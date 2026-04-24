import { useEffect, useState } from "react";
import Forecast from "./pages/Forecast.jsx";
import Admin from "./pages/Admin.jsx";

function resolvePageFromHash(hash) {
  if (hash === "#forecast") {
    return "forecast";
  }

  if (hash === "#admin") {
    return "admin";
  }

  return "home";
}

function HomePage({ setPage }) {
  return (
    <section className="home-grid">
      <div className="home-copy">
        <p className="eyebrow">Prism Sales Planning</p>
        <h1>Forecast demand before the month starts.</h1>
        <p>
          Review dealer, state, and zone trends from the latest forecast run, then narrow demand
          by model and variant when the planning question needs more detail.
        </p>
        <button type="button" onClick={() => setPage("forecast")}>
          Open forecast
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
  const [page, setPage] = useState(() => resolvePageFromHash(window.location.hash));

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

  return (
    <main>
      <nav className="top-nav" aria-label="Primary navigation">
        <a className={page === "home" ? "active" : ""} href="#home" onClick={() => navigate("home")}>
          Home
        </a>
        <a className={page === "forecast" ? "active" : ""} href="#forecast" onClick={() => navigate("forecast")}>
          Forecast
        </a>
        <a className={page === "admin" ? "active" : ""} href="#admin" onClick={() => navigate("admin")}>
          Admin
        </a>
      </nav>

      {page === "forecast" ? <Forecast /> : page === "admin" ? <Admin /> : <HomePage setPage={navigate} />}
    </main>
  );
}
