import { useEffect, useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function App() {
  const [health, setHealth] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    async function fetchHealth() {
      try {
        const response = await fetch(`${apiUrl}/api/health`);
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = await response.json();
        setHealth({ loading: false, error: "", data });
      } catch (error) {
        setHealth({
          loading: false,
          error: error.message || "Unable to reach the API",
          data: null
        });
      }
    }

    fetchHealth();
  }, []);

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">npm workspaces monorepo</p>
        <h1>ReactJS frontend, Node backend, PostgreSQL-ready API.</h1>
        <p className="lead">
          This starter gives you a Vite ReactJS client, an Express API, and a PostgreSQL
          connection layer that is ready for local Docker development.
        </p>

        <div className="status-panel">
          <span className="status-label">Backend status</span>
          {health.loading && <strong>Checking API...</strong>}
          {health.error && <strong className="error-text">Unavailable: {health.error}</strong>}
          {health.data && (
            <strong className="success-text">
              {health.data.message} on port {health.data.port}
            </strong>
          )}
        </div>

        <div className="info-grid">
          <article>
            <h2>Frontend</h2>
            <p>ReactJS 18 with Vite for a fast local development loop.</p>
          </article>
          <article>
            <h2>Backend</h2>
            <p>Express API with CORS, environment config, and PostgreSQL health routes.</p>
          </article>
          <article>
            <h2>Database</h2>
            <p>PostgreSQL via Docker Compose, with a reusable `pg` connection pool.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
