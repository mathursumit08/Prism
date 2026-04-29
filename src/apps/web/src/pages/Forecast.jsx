import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

const forecastLevels = [
  { value: "zone", label: "Zone" },
  { value: "state", label: "State" },
  { value: "dealer", label: "Dealers" }
];

const leadingEntityLabels = {
  zone: "zone",
  state: "state",
  dealer: "dealer"
};

const forecastHorizons = [6, 12, 24];

function getSeriesColor(index, total, alpha = 1) {
  const hue = Math.round((index * 137.508) % 360);
  const saturation = 64 + ((index * 17) % 22);
  const lightness = 32 + ((index * 11) % 24);
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

function getSeriesId(item) {
  return item.seriesKey || item.groupId;
}

function getSeriesLabel(item) {
  return item.seriesLabel || item.groupLabel;
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

function formatChartMonth(value) {
  return new Intl.DateTimeFormat("en", { month: "short", year: "2-digit" }).format(new Date(value));
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

function sumSeriesByMonth(collections, key) {
  const months = [...new Set(collections.flatMap((item) => item[key].map((point) => point.month)))].sort();

  return months.map((month) => ({
    month,
    unitsSold: collections.reduce(
      (sum, item) => sum + (item[key].find((point) => point.month === month)?.unitsSold || 0),
      0
    )
  }));
}

function buildContributionMonths(series) {
  const months = [...new Set(series.flatMap((item) => item.forecast.map((point) => point.month)))].sort();

  return months.map((month) => ({
    month,
    total: series.reduce(
      (sum, item) => sum + (item.forecast.find((point) => point.month === month)?.unitsSold || 0),
      0
    ),
    groups: series.map((item, index) => ({
      groupId: getSeriesId(item),
      groupLabel: getSeriesLabel(item),
      unitsSold: item.forecast.find((point) => point.month === month)?.unitsSold || 0,
      color: getSeriesColor(index, series.length)
    }))
  }));
}

function aggregateSeriesBySegment(series) {
  const grouped = new Map();

  for (const item of series) {
    const segmentLabel = item.segment || getSeriesLabel(item) || "Unassigned";

    if (!grouped.has(segmentLabel)) {
      grouped.set(segmentLabel, {
        ...item,
        groupId: segmentLabel,
        groupLabel: segmentLabel,
        seriesKey: segmentLabel,
        seriesLabel: segmentLabel,
        segment: segmentLabel,
        forecast: item.forecast.map((point) => ({
          ...point,
          unitsSold: 0
        }))
      });
    }

    const aggregate = grouped.get(segmentLabel);
    item.forecast.forEach((point, index) => {
      aggregate.forecast[index].unitsSold += point.unitsSold;
    });
  }

  return [...grouped.values()];
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
  const padding = { top: 24, right: 28, bottom: 68, left: 66 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xAxisLabelY = padding.top + chartHeight + 12;
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
          <text
            key={point.month}
            x={xFor(index)}
            y={xAxisLabelY}
            textAnchor="end"
            transform={`rotate(-90 ${xFor(index)} ${xAxisLabelY})`}
          >
            {formatChartMonth(point.month)}
          </text>
        ))}

        {series.map((item, itemIndex) => {
          const seriesId = getSeriesId(item);
          const label = getSeriesLabel(item);
          const path = item.forecast
            .map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${xFor(pointIndex)} ${yFor(point.unitsSold)}`)
            .join(" ");
          const isHovered = hoveredGroupId === seriesId;
          const hasHoveredSeries = Boolean(hoveredGroupId);
          const color = getSeriesColor(itemIndex, series.length);
          const seriesOpacity = isHovered ? 1 : hasHoveredSeries ? 0.14 : 0.5;

          return (
            <g
              key={seriesId}
              className={isHovered ? "series active" : "series"}
              onMouseEnter={() => onHoverGroup(seriesId)}
              onMouseLeave={() => onHoverGroup("")}
            >
              <path
                d={path}
                stroke={color}
                strokeWidth={isHovered ? 2 : 1}
                opacity={seriesOpacity}
              >
                <title>{label}</title>
              </path>
              {item.forecast.map((point, pointIndex) => (
                <circle
                  key={`${seriesId}-${point.month}`}
                  cx={xFor(pointIndex)}
                  cy={yFor(point.unitsSold)}
                  r={isHovered ? 3 : 2}
                  fill={color}
                  opacity={seriesOpacity}
                >
                  <title>{`${label}: ${formatUnits(point.unitsSold)} units`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TrendChart({ actualTotals, forecastTotals }) {
  const width = 920;
  const height = 320;
  const padding = { top: 20, right: 28, bottom: 68, left: 64 };
  const merged = [
    ...actualTotals.map((point) => ({ ...point, kind: "actual" })),
    ...forecastTotals.map((point) => ({ ...point, kind: "forecast" }))
  ];

  if (!merged.length) {
    return <div className="empty-chart">Actual and forecast trend data will appear here when available.</div>;
  }

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...merged.map((point) => point.unitsSold), 1);
  const timeline = [...new Set(merged.map((point) => point.month))];
  const xAxisLabelY = padding.top + chartHeight + 12;
  const xFor = (index) => padding.left + (index / Math.max(timeline.length - 1, 1)) * chartWidth;
  const yFor = (value) => padding.top + chartHeight - (value / maxValue) * chartHeight;

  const buildPath = (points) =>
    points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(timeline.indexOf(point.month))} ${yFor(point.unitsSold)}`)
      .join(" ");

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Actual versus forecast trend</title>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const y = padding.top + chartHeight - step * chartHeight;
          const value = Math.round(maxValue * step);
          return (
            <g key={step}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text x={padding.left - 12} y={y + 5} textAnchor="end">
                {formatUnits(value)}
              </text>
            </g>
          );
        })}
        {timeline.map((month, index) => (
          <text
            key={month}
            x={xFor(index)}
            y={xAxisLabelY}
            textAnchor="end"
            transform={`rotate(-90 ${xFor(index)} ${xAxisLabelY})`}
          >
            {formatChartMonth(month)}
          </text>
        ))}
        {actualTotals.length > 0 && <path d={buildPath(actualTotals)} stroke="#202020" strokeWidth="3" />}
        {forecastTotals.length > 0 && (
          <path
            d={buildPath(forecastTotals)}
            stroke="#00796b"
            strokeWidth="3"
            strokeDasharray="8 6"
          />
        )}
      </svg>
    </div>
  );
}

function ContributionChart({ series, message = "Forecast contribution data will appear here when available." }) {
  const months = buildContributionMonths(series);
  const width = 920;
  const height = 320;
  const padding = { top: 20, right: 20, bottom: 68, left: 64 };

  if (!months.length) {
    return <div className="empty-chart">{message}</div>;
  }

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...months.map((month) => month.total), 1);
  const barWidth = (chartWidth / Math.max(months.length, 1)) * 0.68;
  const xAxisLabelY = padding.top + chartHeight + 12;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Forecast contribution</title>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const y = padding.top + chartHeight - step * chartHeight;
          const value = Math.round(maxValue * step);
          return (
            <g key={step}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text x={padding.left - 12} y={y + 5} textAnchor="end">
                {formatUnits(value)}
              </text>
            </g>
          );
        })}
        {months.map((month, monthIndex) => {
          const x = padding.left + (monthIndex / months.length) * chartWidth + 10;
          let runningHeight = 0;

          return (
            <g key={month.month}>
              {month.groups.map((group) => {
                const segmentHeight = (group.unitsSold / maxValue) * chartHeight;
                const y = padding.top + chartHeight - runningHeight - segmentHeight;
                runningHeight += segmentHeight;

                return (
                  <rect
                    key={`${month.month}-${group.groupId}`}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(segmentHeight, 1)}
                    fill={group.color}
                    opacity="0.82"
                  >
                    <title>{`${group.groupLabel}: ${formatUnits(group.unitsSold)} units`}</title>
                  </rect>
                );
              })}
              <text
                x={x + barWidth / 2}
                y={xAxisLabelY}
                textAnchor="end"
                transform={`rotate(-90 ${x + barWidth / 2} ${xAxisLabelY})`}
              >
                {formatChartMonth(month.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function ForecastPage() {
  const { apiFetch, user } = useAuth();
  const availableLevels = forecastLevels.filter((option) => user.forecastLevels.includes(option.value));
  const [level, setLevel] = useState(availableLevels[0]?.value || "dealer");
  const [dealerId, setDealerId] = useState("");
  const [stateId, setStateId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [segment, setSegment] = useState("");
  const [modelId, setModelId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [horizonMonths, setHorizonMonths] = useState(6);
  const [hoveredGroupId, setHoveredGroupId] = useState("");
  const [hoveredBreakdownId, setHoveredBreakdownId] = useState("");
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
  const [actualState, setActualState] = useState({
    loading: true,
    error: "",
    series: []
  });
  const [breakdownState, setBreakdownState] = useState({
    loading: false,
    error: "",
    series: []
  });

  useEffect(() => {
    if (availableLevels.length > 0 && !availableLevels.some((option) => option.value === level)) {
      setLevel(availableLevels[0].value);
    }
  }, [availableLevels, level]);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchReferences() {
      try {
        const [dealersResponse, modelsResponse, variantsResponse] = await Promise.all([
          apiFetch("/api/dealers", { signal: controller.signal }),
          apiFetch("/api/models", { signal: controller.signal }),
          apiFetch("/api/variants", { signal: controller.signal })
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
  }, [apiFetch]);

  const dealers = referenceState.dealers;
  const models = referenceState.models;
  const variants = referenceState.variants;

  const states = useMemo(
    () => [...new Set(dealers.map((dealer) => dealer.state).filter(Boolean))].sort(),
    [dealers]
  );
  const zones = useMemo(
    () => [...new Set(dealers.map((dealer) => dealer.region).filter(Boolean))].sort(),
    [dealers]
  );
  const segments = useMemo(
    () => [...new Set(models.map((model) => model.segment).filter(Boolean))].sort(),
    [models]
  );

  const filteredModels = useMemo(() => {
    if (!segment) {
      return models;
    }

    return models.filter((model) => model.segment === segment);
  }, [models, segment]);

  const filteredVariants = useMemo(() => {
    if (!modelId) {
      return [];
    }

    return variants.filter((variant) => variant.modelId === modelId);
  }, [variants, modelId]);

  const selectedModel = filteredModels.find((model) => model.id === modelId);
  const selectedVariant = filteredVariants.find((variant) => variant.id === variantId);

  useEffect(() => {
    if (!filteredModels.some((model) => model.id === modelId)) {
      setModelId("");
      setVariantId("");
    }
  }, [filteredModels, modelId]);

  useEffect(() => {
    if (!filteredVariants.some((variant) => variant.id === variantId)) {
      setVariantId("");
    }
  }, [filteredVariants, variantId]);

  const groupId = level === "dealer" ? dealerId : level === "state" ? stateId : zoneId;
  const selectedRegionLabel = level === "zone" ? zoneId : level === "state" ? stateId : dealerId;
  const rollupLabel = level === "zone" ? "All zones" : level === "state" ? "All states" : dealerId ? "Selected dealer" : "All dealers";
  const breakdownContextLabel = selectedRegionLabel || rollupLabel;
  const shouldLoadBreakdown = !modelId && !variantId;

  useEffect(() => {
    const controller = new AbortController();

    async function loadForecastAndActuals() {
      setForecastState((current) => ({
        ...current,
        loading: true,
        error: ""
      }));
      setActualState((current) => ({
        ...current,
        loading: true,
        error: ""
      }));

      try {
        const params = new URLSearchParams();
        params.set("level", level);

        if (groupId) {
          params.set("groupId", groupId);
        }

        if (segment) {
          params.set("segment", segment);
        }

        if (modelId) {
          params.set("modelId", modelId);
        }

        if (variantId) {
          params.set("variantId", variantId);
        }

        const [forecastResponse, actualResponse] = await Promise.all([
          apiFetch(`/api/v1/forecasts/baseline?${params}`, {
            signal: controller.signal
          }),
          apiFetch(`/api/v1/forecasts/actuals?${params}`, {
            signal: controller.signal
          })
        ]);

        if (!forecastResponse.ok) {
          let message;
          try {
            const data = await forecastResponse.json();
            message = data.error;
          } catch {
            message = `Forecast API returned ${forecastResponse.status}`;
          }
          throw new Error(message || "Forecast data API is unavailable");
        }

        const forecastData = await forecastResponse.json();
        if (!forecastData.series?.length) {
          throw new Error("No forecast data is available for the selected filters.");
        }

        const actualData = actualResponse.ok ? await actualResponse.json() : { series: [] };

        setForecastState({
          loading: false,
          error: "",
          series: forecastData.series
        });
        setActualState({
          loading: false,
          error: "",
          series: actualData.series || []
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
        setActualState({
          loading: false,
          error: "",
          series: []
        });
      }
    }

    loadForecastAndActuals();

    return () => controller.abort();
  }, [apiFetch, level, groupId, segment, modelId, variantId]);

  useEffect(() => {
    if (!shouldLoadBreakdown) {
      setBreakdownState({
        loading: false,
        error: "",
        series: []
      });
      return undefined;
    }

    const controller = new AbortController();

    async function loadSegmentBreakdown() {
      setBreakdownState({
        loading: true,
        error: "",
        series: []
      });

      try {
        const params = new URLSearchParams();
        params.set("level", level);
        params.set("groupId", groupId);
        params.set("breakdown", "segment");

        if (segment) {
          params.set("segment", segment);
        }

        const response = await apiFetch(`/api/v1/forecasts/baseline?${params}`, {
          signal: controller.signal
        });

        if (!response.ok) {
          let message;
          try {
            const data = await response.json();
            message = data.error;
          } catch {
            message = `Forecast breakdown API returned ${response.status}`;
          }

          throw new Error(message || "Segment breakdown data is unavailable");
        }

        const data = await response.json();
        setBreakdownState({
          loading: false,
          error: "",
          series: data.series || []
        });
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setBreakdownState({
          loading: false,
          error: error.message || "Unable to load segment breakdown",
          series: []
        });
      }
    }

    loadSegmentBreakdown();

    return () => controller.abort();
  }, [apiFetch, groupId, level, segment, shouldLoadBreakdown]);

  const visibleSeries = useMemo(
    () => limitSeriesMonths(forecastState.series, horizonMonths),
    [forecastState.series, horizonMonths]
  );
  const visibleBreakdownSeries = useMemo(() => {
    const normalizedSeries = groupId ? breakdownState.series : aggregateSeriesBySegment(breakdownState.series);
    return limitSeriesMonths(normalizedSeries, horizonMonths);
  }, [breakdownState.series, groupId, horizonMonths]);

  const chartMessage = forecastState.loading
    ? "Loading live forecast data..."
    : forecastState.error || "No forecast data is available for the selected filters.";
  const breakdownMessage = !shouldLoadBreakdown
    ? "Segment split is unavailable while model or variant filters are applied."
    : breakdownState.loading
      ? "Loading regional segment breakdown..."
      : breakdownState.error || "No segment breakdown data is available for the selected scope.";
  const hasForecastData = visibleSeries.length > 0;
  const hasBreakdownData = visibleBreakdownSeries.length > 0;
  const summary = hasForecastData ? summarizeSeries(visibleSeries) : { total: 0, growth: 0, leader: null };
  const breakdownSummary = hasBreakdownData
    ? summarizeSeries(visibleBreakdownSeries)
    : { total: 0, growth: 0, leader: null };
  const actualTotals = useMemo(
    () => sumSeriesByMonth(actualState.series, "actuals").slice(-Math.max(horizonMonths, 6)),
    [actualState.series, horizonMonths]
  );
  const forecastTotals = useMemo(
    () => sumSeriesByMonth(visibleSeries, "forecast"),
    [visibleSeries]
  );

  return (
    <>
      <section className="dashboard-header">
        <div>
          <p className="eyebrow">Forecast dashboard</p>
          <h1>Track zone and state forecasts with a live segment split for each region.</h1>
        </div>
        <img
          src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80"
          alt="Forecast analytics dashboard"
        />
      </section>

      <section className="controls-band">
        <div className="controls-row">
          <label>
            Forecast level
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              {availableLevels.map((option) => (
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
                {dealers.map((dealer) => (
                  <option key={dealer.id} value={dealer.id}>
                    {dealer.name}
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
            Forecast months
            <select value={horizonMonths} onChange={(event) => setHorizonMonths(Number(event.target.value))}>
              {forecastHorizons.map((months) => (
                <option key={months} value={months}>
                  {months} months
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="controls-row controls-row-products">
          <label>
            Segment
            <select
              value={segment}
              onChange={(event) => setSegment(event.target.value)}
              disabled={referenceState.loading}
            >
              <option value="">All segments</option>
              {segments.map((segmentName) => (
                <option key={segmentName} value={segmentName}>
                  {segmentName}
                </option>
              ))}
            </select>
          </label>

          <label>
            Model
            <select
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              disabled={referenceState.loading}
            >
              <option value="">All models</option>
              {filteredModels.map((model) => (
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
        </div>
      </section>

      {referenceState.error && (
        <p className="page-notice">Reference data could not be loaded from the database: {referenceState.error}</p>
      )}

      <section className="summary-grid forecast-summary-grid" aria-label="Forecast summary">
        <article className="metric">
          <span>{horizonMonths}-month forecast</span>
          <strong>{hasForecastData ? formatUnits(summary.total) : "No data"}</strong>
          <p>
            {hasForecastData
              ? `${selectedRegionLabel || "All regions"}${segment ? `, ${segment}` : ""}${selectedVariant ? `, ${selectedVariant.name}` : selectedModel ? `, ${selectedModel.name}` : ""}`
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
          <span>Leading {leadingEntityLabels[level] || "group"}</span>
          <strong>{hasForecastData ? getSeriesLabel(summary.leader) : "No data"}</strong>
          <p>{availableLevels.find((item) => item.value === level)?.label}</p>
        </article>
        <article className="metric">
          <span>Leading segment</span>
          <strong>{hasBreakdownData ? getSeriesLabel(breakdownSummary.leader) : "No data"}</strong>
          <p>
            {hasBreakdownData
              ? `${visibleBreakdownSeries.length}/${segments.length || visibleBreakdownSeries.length} configured segments covered`
              : "Segment breakdown unavailable"}
          </p>
        </article>
      </section>

      <section className="analytics-grid" aria-label="Forecast analytics">
        <article className="analytics-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Trend</p>
              <h2>Actual vs Forecast trend</h2>
            </div>
          </div>
          {(forecastState.error || actualState.error) && (
            <p className="notice compact-notice">{forecastState.error || actualState.error}</p>
          )}
          <TrendChart actualTotals={actualTotals} forecastTotals={forecastTotals} />
          <div className="chart-legend trend-legend">
            <span>
              <i className="legend-line actual-line" />
              Actual
            </span>
            <span>
              <i className="legend-line forecast-line" />
              Forecast
            </span>
          </div>
        </article>

        <article className="analytics-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Segment split</p>
              <h2>
                {shouldLoadBreakdown
                  ? `Forecast by segment for ${breakdownContextLabel}`
                  : "Regional segment breakdown"}
              </h2>
            </div>
          </div>
          {breakdownState.error && <p className="notice compact-notice">{breakdownState.error}</p>}
          <ContributionChart series={visibleBreakdownSeries} message={breakdownMessage} />
        </article>
      </section>

      <section className="forecast-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Forecast graph</p>
            <h2>Monthly units by {availableLevels.find((item) => item.value === level)?.label.toLowerCase()}</h2>
          </div>
          <span className={hasForecastData ? "source-pill live" : "source-pill"}>
            {forecastState.loading ? "Loading" : hasForecastData ? "Live API" : "No data"}
          </span>
        </div>

        {forecastState.error && <p className="notice">{forecastState.error}</p>}

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
                key={getSeriesId(item)}
                className={hoveredGroupId === getSeriesId(item) ? "active" : ""}
                onMouseEnter={() => setHoveredGroupId(getSeriesId(item))}
                onMouseLeave={() => setHoveredGroupId("")}
              >
                <i style={{ backgroundColor: getSeriesColor(index, visibleSeries.length, 0.5) }} />
                {getSeriesLabel(item)}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="forecast-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Regional segment split</p>
            <h2>{shouldLoadBreakdown ? `Segments within ${breakdownContextLabel}` : "Model or variant filter active"}</h2>
          </div>
          <span className={hasBreakdownData ? "source-pill live" : "source-pill"}>
            {breakdownState.loading ? "Loading" : hasBreakdownData ? "Cached API" : "No data"}
          </span>
        </div>

        {breakdownState.error && <p className="notice">{breakdownState.error}</p>}

        <ForecastChart
          series={visibleBreakdownSeries}
          hoveredGroupId={hoveredBreakdownId}
          onHoverGroup={setHoveredBreakdownId}
          message={breakdownMessage}
        />

        {hasBreakdownData && (
          <div className="legend">
            {visibleBreakdownSeries.map((item, index) => (
              <span
                key={getSeriesId(item)}
                className={hoveredBreakdownId === getSeriesId(item) ? "active" : ""}
                onMouseEnter={() => setHoveredBreakdownId(getSeriesId(item))}
                onMouseLeave={() => setHoveredBreakdownId("")}
              >
                <i style={{ backgroundColor: getSeriesColor(index, visibleBreakdownSeries.length, 0.5) }} />
                {getSeriesLabel(item)}
              </span>
            ))}
          </div>
        )}
      </section>

      {hasBreakdownData && (
        <section className="data-table" aria-label="Segment breakdown data table">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Segment breakdown</p>
              <h2>Next {horizonMonths} months for {breakdownContextLabel}</h2>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Segment</th>
                  {visibleBreakdownSeries[0]?.forecast.map((point) => (
                    <th key={point.month}>{formatMonth(point.month)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleBreakdownSeries.map((item) => (
                  <tr key={getSeriesId(item)}>
                    <th>{getSeriesLabel(item)}</th>
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
                  <th>{availableLevels.find((item) => item.value === level)?.label}</th>
                  {visibleSeries[0]?.forecast.map((point) => (
                    <th key={point.month}>{formatMonth(point.month)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleSeries.map((item) => (
                  <tr key={getSeriesId(item)}>
                    <th>{getSeriesLabel(item)}</th>
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
