import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

function groupCards(cards) {
  return cards.reduce((groups, card) => {
    const key = card.category || "Graphs";
    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(card);
    return groups;
  }, {});
}

export default function DashboardCardsPage() {
  const { apiFetch } = useAuth();
  const [state, setState] = useState({
    loading: true,
    saving: false,
    error: "",
    message: "",
    cards: []
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadCards() {
      try {
        const response = await apiFetch("/api/v1/forecasts/dashboard-cards", {
          signal: controller.signal
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load dashboard cards.");
        }

        setState({
          loading: false,
          saving: false,
          error: "",
          message: "",
          cards: payload.cards || []
        });
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setState({
          loading: false,
          saving: false,
          error: error.message || "Unable to load dashboard cards.",
          message: "",
          cards: []
        });
      }
    }

    loadCards();

    return () => controller.abort();
  }, [apiFetch]);

  function updateCard(cardKey, enabled) {
    setState((current) => ({
      ...current,
      message: "",
      cards: current.cards.map((card) => (card.key === cardKey ? { ...card, enabled } : card))
    }));
  }

  async function saveCards() {
    setState((current) => ({
      ...current,
      saving: true,
      error: "",
      message: ""
    }));

    try {
      const response = await apiFetch("/api/v1/forecasts/admin/dashboard-cards", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          cards: state.cards.map((card) => ({
            key: card.key,
            enabled: card.enabled
          }))
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to save dashboard cards.");
      }

      setState({
        loading: false,
        saving: false,
        error: "",
        message: "Dashboard card visibility saved.",
        cards: payload.cards || []
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        saving: false,
        error: error.message || "Unable to save dashboard cards."
      }));
    }
  }

  const groupedCards = groupCards(state.cards);

  return (
    <>
      <section className="dashboard-header">
        <div>
          <p className="eyebrow">Dashboard Cards</p>
          <h1>Choose which forecast cards appear on the Home dashboard.</h1>
          <p className="admin-header-copy">Changes apply globally for users who can view the forecast dashboard.</p>
        </div>
        <div className="admin-hero-card">
          <span className="status-badge healthy">Admin only</span>
          <strong>{state.cards.filter((card) => card.enabled).length}/{state.cards.length || 0}</strong>
          <p>Cards currently visible</p>
        </div>
      </section>

      {state.error && <p className="page-notice">{state.error}</p>}
      {state.message && <p className="page-success">{state.message}</p>}

      <section className="forecast-panel dashboard-card-manager">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Visibility</p>
            <h2>Forecast screen cards</h2>
          </div>
          <button type="button" onClick={saveCards} disabled={state.loading || state.saving || !state.cards.length}>
            {state.saving ? "Saving" : "Save changes"}
          </button>
        </div>

        {state.loading ? (
          <p className="notice compact-notice">Loading dashboard cards...</p>
        ) : (
          <div className="dashboard-card-groups">
            {Object.entries(groupedCards).map(([category, cards]) => (
              <section key={category} className="dashboard-card-group">
                <h3>{category}</h3>
                <div className="dashboard-card-toggle-grid">
                  {cards.map((card) => (
                    <label key={card.key} className="dashboard-card-toggle">
                      <input
                        type="checkbox"
                        checked={card.enabled}
                        onChange={(event) => updateCard(card.key, event.target.checked)}
                      />
                      <span>
                        <strong>{card.label}</strong>
                        <small>{card.enabled ? "Visible" : "Hidden"}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
