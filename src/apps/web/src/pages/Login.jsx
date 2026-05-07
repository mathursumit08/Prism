import { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await login({ username, password });
    } catch (loginError) {
      setError(loginError.message || "Unable to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="login-card">
        <div className="login-copy">
          <img
            className="login-logo"
            src="/resources/images/prism-sales-forecasting-logo.png"
            alt="PRISM Sales Forecasting"
          />
          <p className="eyebrow">Secure Planning Workspace</p>
          <h1>Sign in</h1>
          <p>
            Access the sales planning workspace to review forecasts, diagnostics, events, and administration tools.
          </p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-form-heading">
            <p className="eyebrow">Account Access</p>
            <h2>Enter credentials</h2>
          </div>

          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && <p className="page-notice login-notice">{error}</p>}

          <button type="submit" disabled={submitting || !username || !password}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
