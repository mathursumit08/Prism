import { useEffect, useMemo, useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:4000";

const forecastLevels = [
  { value: "dealer", label: "Dealers" },
  { value: "state", label: "State" },
  { value: "zone", label: "Zone" }
];

const forecastHorizons = [6, 12, 24];

function getSeriesColor(index, total, alpha = 1) {
  const hue = Math.round((index * 137.508) % 360);
  const saturation = 64 + ((index * 17) % 22);
  const lightness = 32 + ((index * 11) % 24);
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

function limitSeriesMonths(series, months) {
  return series
    .map((item) => ({
      ...item,
      forecast: item.forecast.slice(0, months)
    }))
    .filter((item) => item.forecast.length > 0);
}

function formatMonth(value) {
  return new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(value));
}

function formatUnits(value) {
  return new Intl.NumberFormat("en-IN").format(Math.round(value || 0));
}

function summarizeSeries(series) {
  const total = series.reduce(
    (sum, item) => sum + item.forecast.reduce((itemSum, point) => itemSum + point.unitsSold, 0),
    0
  );
  const firstMonth = series.reduce((sum, item) => sum + (item.forecast[0]?.unitsSold || 0), 0);
  const lastMonth = series.reduce(
    (sum, item) => sum + (item.forecast[item.forecast.length - 1]?.unitsSold || 0),
    0
  );
  const growth = firstMonth ? ((lastMonth - firstMonth) / firstMonth) * 100 : 0;
  const leader = [...series].sort((a, b) => {
    const aTotal = a.forecast.reduce((sum, point) => sum + point.unitsSold, 0);
    const bTotal = b.forecast.reduce((sum, point) => sum + point.unitsSold, 0);
    return bTotal - aTotal;
  })[0];

  return { total, firstMonth, lastMonth, growth, leader };
}

function ForecastChart({
  series,
  hoveredGroupId,
  onHoverGroup,
  message = "Forecast data will appear here when it is available."
}) {
  if (!series.length) {
    return <div className="empty-chart">{message}</div>;
  }

  const width = 920;
  const height = 360;
  const padding = { top: 24, right: 28, bottom: 52, left: 66 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const points = series.flatMap((item) => item.forecast);
  const maxValue = Math.max(...points.map((point) => point.unitsSold), 1);
  const minValue = Math.min(...points.map((point) => point.unitsSold), 0);
  const range = Math.max(maxValue - minValue, 1);
  const monthCount = series[0]?.forecast.length || 1;

  const xFor = (index) => padding.left + (index / Math.max(monthCount - 1, 1)) * chartWidth;
  const yFor = (value) => padding.top + chartHeight - ((value - minValue) / range) * chartHeight;
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((step) => {
    const value = minValue + range * step;
    return { value, y: yFor(value) };
  });

  return (
    <div className="chart-wrap" aria-label="Forecast units by month">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Forecast units by month</title>
        {gridLines.map((line) => (
          <g key={line.y}>
            <line x1={padding.left} x2={width - padding.right} y1={line.y} y2={line.y} />
            <text x={padding.left - 14} y={line.y + 5} textAnchor="end">
              {formatUnits(line.value)}
            </text>
          </g>
        ))}

        {series[0]?.forecast.map((point, index) => (
          <text key={point.month} x={xFor(index)} y={height - 18} textAnchor="middle">
            {formatMonth(point.month)}
          </text>
        ))}

        {series.map((item, itemIndex) => {
          const path = item.forecast
            .map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${xFor(pointIndex)} ${yFor(point.unitsSold)}`)
            .join(" ");
          const isHovered = hoveredGroupId === item.groupId;
          const hasHoveredSeries = Boolean(hoveredGroupId);
          const color = getSeriesColor(itemIndex, series.length);
          const seriesOpacity = isHovered ? 1 : hasHoveredSeries ? 0.14 : 0.5;

          return (
            <g
              key={item.groupId}
              className={isHovered ? "series active" : "series"}
              onMouseEnter={() => onHoverGroup(item.groupId)}
              onMouseLeave={() => onHoverGroup("")}
            >
              <path
                d={path}
                stroke={color}
                strokeWidth={isHovered ? 2 : 1}
                opacity={seriesOpacity}
              >
                <title>{item.groupLabel}</title>
              </path>
              {item.forecast.map((point, pointIndex) => (
                <circle
                  key={`${item.groupId}-${point.month}`}
                  cx={xFor(pointIndex)}
                  cy={yFor(point.unitsSold)}
                  r={isHovered ? 3 : 2}
                  fill={color}
                  opacity={seriesOpacity}
                >
                  <title>{`${item.groupLabel}: ${formatUnits(point.unitsSold)} units`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
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

function ForecastPage() {
  const [level, setLevel] = useState("dealer");
  const [dealerId, setDealerId] = useState("");
  const [stateId, setStateId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [modelId, setModelId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [horizonMonths, setHorizonMonths] = useState(6);
  const [hoveredGroupId, setHoveredGroupId] = useState("");
  const [referenceState, setReferenceState] = useState({
    loading: true,
    error: "",
    dealers: [],
    models: [],
    variants: []
  });
  const [forecastState, setForecastState] = useState({
    loading: true,
    error: "",
    series: []
  });

  useEffect(() => {
    const controller = new AbortController();

    async function fetchReferences() {
      try {
        const [dealersResponse, modelsResponse, variantsResponse] = await Promise.all([
          fetch(`${apiUrl}/api/dealers`, { signal: controller.signal }),
          fetch(`${apiUrl}/api/models`, { signal: controller.signal }),
          fetch(`${apiUrl}/api/variants`, { signal: controller.signal })
        ]);

        if (!dealersResponse.ok || !modelsResponse.ok || !variantsResponse.ok) {
          throw new Error("Reference data API is unavailable");
        }

        const [dealersData, modelsData, variantsData] = await Promise.all([
          dealersResponse.json(),
          modelsResponse.json(),
          variantsResponse.json()
        ]);

        setReferenceState({
          loading: false,
          error: "",
          dealers: dealersData.dealers || [],
          models: modelsData.models || [],
          variants: variantsData.variants || []
        });
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setReferenceState({
          loading: false,
          error: error.message || "Unable to load reference data",
          dealers: [],
          models: [],
          variants: []
        });
      }
    }

    fetchReferences();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    setDealerId("");
    setStateId("");
    setZoneId("");
  }, [level]);

  useEffect(() => {
    setVariantId("");
  }, [modelId]);

  const filteredVariants = useMemo(() => {
    if (!modelId) {
      return [];
    }

    return referenceState.variants.filter((variant) => variant.modelId === modelId);
  }, [modelId, referenceState.variants]);

  const states = useMemo(
    () => [...new Set(referenceState.dealers.map((dealer) => dealer.state).filter(Boolean))].sort(),
    [referenceState.dealers]
  );
  const zones = useMemo(
    () => [...new Set(referenceState.dealers.map((dealer) => dealer.region).filter(Boolean))].sort(),
    [referenceState.dealers]
  );

  const visibleSeries = useMemo(
    () => limitSeriesMonths(forecastState.series, horizonMonths),
    [forecastState.series, horizonMonths]
  );
  const hasForecastData = visibleSeries.length > 0;
  const chartMessage = forecastState.loading
    ? "Loading live forecast data..."
    : forecastState.error || "No forecast data is available for the selected filters.";

  const selectedModel = referenceState.models.find((model) => model.id === modelId);
  const selectedVariant = referenceState.variants.find((variant) => variant.id === variantId);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchForecast() {
      const params = new URLSearchParams({ level });
      if (level === "dealer" && dealerId) {
        params.set("dealerId", dealerId);
      }
      if (level === "state" && stateId) {
        params.set("groupId", stateId);
      }
      if (level === "zone" && zoneId) {
        params.set("groupId", zoneId);
      }
      if (modelId) {
        params.set("modelId", modelId);
      }
      if (variantId) {
        params.set("variantId", variantId);
      }

      setForecastState((current) => ({ ...current, loading: true, error: "" }));

      try {
        const response = await fetch(`${apiUrl}/api/forecasts/baseline?${params}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          let message = "Forecast data is not available right now.";
          try {
            const data = await response.json();
            message = data.error || message;
          } catch {
            message = `Forecast API returned ${response.status}`;
          }

          throw new Error(message);
        }

        const data = await response.json();
        if (!data.series?.length) {
          throw new Error("No forecast data is available for the selected filters.");
        }

        setForecastState({
          loading: false,
          error: "",
          series: data.series
        });
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setForecastState({
          loading: false,
          error: error.message || "Unable to load forecast data",
          series: []
        });
      }
    }

    fetchForecast();

    return () => controller.abort();
  }, [level, dealerId, stateId, zoneId, modelId, variantId]);

  const summary = useMemo(() => summarizeSeries(visibleSeries), [visibleSeries]);

  return (
    <>
      <section className="dashboard-header">
        <div>
          <p className="eyebrow">Sales Forecasting</p>
          <h1>Forecast demand by market level, model, and variant.</h1>
        </div>
        <img
          src="https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=900&q=80"
          alt="Demand planning discussion"
        />
      </section>

      <section className="controls-band" aria-label="Forecast filters">
        <label>
          Forecast level
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            {forecastLevels.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {level === "dealer" && (
          <label>
            Dealer
            <select
              value={dealerId}
              onChange={(event) => setDealerId(event.target.value)}
              disabled={referenceState.loading}
            >
              <option value="">All dealers</option>
              {referenceState.dealers.map((dealer) => (
                <option key={dealer.id} value={dealer.id}>
                  {dealer.name} - {dealer.city}
                </option>
              ))}
            </select>
          </label>
        )}

        {level === "state" && (
          <label>
            State
            <select
              value={stateId}
              onChange={(event) => setStateId(event.target.value)}
              disabled={referenceState.loading}
            >
              <option value="">All states</option>
              {states.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </label>
        )}

        {level === "zone" && (
          <label>
            Zone
            <select
              value={zoneId}
              onChange={(event) => setZoneId(event.target.value)}
              disabled={referenceState.loading}
            >
              <option value="">All zones</option>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Model
          <select
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            disabled={referenceState.loading}
          >
            <option value="">All models</option>
            {referenceState.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} - {model.segment}
              </option>
            ))}
          </select>
        </label>

        <label>
          Variant
          <select
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
            disabled={referenceState.loading || !modelId}
          >
            <option value="">All variants</option>
            {filteredVariants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Forecast months
          <select value={horizonMonths} onChange={(event) => setHorizonMonths(Number(event.target.value))}>
            {forecastHorizons.map((months) => (
              <option key={months} value={months}>
                {months} months
              </option>
            ))}
          </select>
        </label>
      </section>

      {referenceState.error && (
        <p className="page-notice">Reference data could not be loaded from the database: {referenceState.error}</p>
      )}

      <section className="summary-grid" aria-label="Forecast summary">
        <article className="metric">
          <span>{horizonMonths}-month forecast</span>
          <strong>{hasForecastData ? formatUnits(summary.total) : "No data"}</strong>
          <p>
            {hasForecastData
              ? `${selectedModel?.name || "All models"}${selectedVariant ? `, ${selectedVariant.name}` : ""}`
              : "No live forecast matched the filters"}
          </p>
        </article>
        <article className="metric">
          <span>Run rate change</span>
          <strong>
            {hasForecastData ? `${summary.growth >= 0 ? "+" : ""}${summary.growth.toFixed(1)}%` : "No data"}
          </strong>
          <p>
            {hasForecastData
              ? `${formatUnits(summary.firstMonth)} to ${formatUnits(summary.lastMonth)} units`
              : "Waiting for live forecast data"}
          </p>
        </article>
        <article className="metric">
          <span>Leading group</span>
          <strong>{summary.leader?.groupLabel || "No data"}</strong>
          <p>{forecastLevels.find((item) => item.value === level)?.label}</p>
        </article>
      </section>

      <section className="forecast-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Forecast graph</p>
            <h2>Monthly units by {forecastLevels.find((item) => item.value === level)?.label.toLowerCase()}</h2>
          </div>
          <span className={hasForecastData ? "source-pill live" : "source-pill"}>
            {forecastState.loading ? "Loading" : hasForecastData ? "Live API" : "No data"}
          </span>
        </div>

        {forecastState.error && (
          <p className="notice">{forecastState.error}</p>
        )}

        <ForecastChart
          series={visibleSeries}
          hoveredGroupId={hoveredGroupId}
          onHoverGroup={setHoveredGroupId}
          message={chartMessage}
        />

        {hasForecastData && (
          <div className="legend">
            {visibleSeries.map((item, index) => (
              <span
                key={item.groupId}
                className={hoveredGroupId === item.groupId ? "active" : ""}
                onMouseEnter={() => setHoveredGroupId(item.groupId)}
                onMouseLeave={() => setHoveredGroupId("")}
              >
                <i style={{ backgroundColor: getSeriesColor(index, visibleSeries.length, 0.5) }} />
                {item.groupLabel}
              </span>
            ))}
          </div>
        )}
      </section>

      {hasForecastData && (
        <section className="data-table" aria-label="Forecast data table">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">Forecast data</p>
            <h2>Next {horizonMonths} months</h2>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                {visibleSeries[0]?.forecast.map((point) => (
                  <th key={point.month}>{formatMonth(point.month)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleSeries.map((item) => (
                <tr key={item.groupId}>
                  <th>{item.groupLabel}</th>
                  {item.forecast.map((point) => (
                    <td key={point.month}>{formatUnits(point.unitsSold)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </>
  );
}

export default function App() {
  const [page, setPage] = useState(() => (window.location.hash === "#forecast" ? "forecast" : "home"));

  useEffect(() => {
    function handleHashChange() {
      setPage(window.location.hash === "#forecast" ? "forecast" : "home");
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function navigate(nextPage) {
    window.location.hash = nextPage === "forecast" ? "forecast" : "home";
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
      </nav>

      {page === "forecast" ? <ForecastPage /> : <HomePage setPage={navigate} />}
    </main>
  );
}
