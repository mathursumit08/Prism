import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import DismissibleMessage from "../components/DismissibleMessage.jsx";
import { buildDashboardCardVisibility, defaultDashboardCardVisibility } from "./Forecast.jsx";

const forecastLevels = [
  { value: "zone", label: "Zone" },
  { value: "state", label: "State" },
  { value: "service_center", label: "Service Centers" }
];
const forecastHorizons = [6, 12, 24];

function resolveDomainSection(domain, hash) {
  if (hash === `#${domain}-dashboard-diagnostics`) return "diagnostics";
  if (hash === `#${domain}-dashboard-leaderboard`) return "leaderboard";
  if (hash === `#${domain}-dashboard-data`) return "data";
  return "monitor";
}

function getCurrentMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function getSeriesId(item) {
  return item.seriesKey || item.groupId;
}

function getSeriesLabel(item) {
  return item.seriesLabel || item.groupLabel;
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

function formatCurrency(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/A";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
    notation: Math.abs(Number(value)) >= 100000 ? "compact" : "standard"
  }).format(Number(value));
}

function formatDecimal(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/A";
  return Number(value).toFixed(digits);
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/A";
  return `${Number(value).toFixed(1)}%`;
}

function getBandLabel(intervalMode) {
  if (intervalMode === "80") return "80% band";
  if (intervalMode === "95") return "95% band";
  return "Point forecast only";
}

function getSeriesColor(index, total = 1, alpha = 1) {
  const hue = Math.round((index * 137.508) % 360);
  const saturation = 64 + ((index * 17) % 22);
  const lightness = 32 + ((index * 11) % 24);
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

function sumSeries(series) {
  return series.reduce((sum, item) => sum + item.forecast.reduce((itemSum, point) => itemSum + point.unitsSold, 0), 0);
}

function summarizeSeries(series) {
  const total = sumSeries(series);
  const firstMonth = series.reduce((sum, item) => sum + (item.forecast[0]?.unitsSold || 0), 0);
  const lastMonth = series.reduce((sum, item) => sum + (item.forecast[item.forecast.length - 1]?.unitsSold || 0), 0);
  const growth = firstMonth ? ((lastMonth - firstMonth) / firstMonth) * 100 : 0;
  const leader = [...series].sort((left, right) => sumSeries([right]) - sumSeries([left]))[0];
  return { total, firstMonth, lastMonth, growth, leader };
}

function summarizeUncertainty(series, bandKey) {
  const widths = series.flatMap((item) =>
    item.forecast.map((point) => {
      if (bandKey === "95") return (point.upper_95 ?? point.unitsSold) - (point.lower_95 ?? point.unitsSold);
      return (point.upper_80 ?? point.unitsSold) - (point.lower_80 ?? point.unitsSold);
    })
  );
  return widths.length ? widths.reduce((sum, width) => sum + width, 0) / widths.length : 0;
}

function sumSeriesByMonth(series) {
  const months = [...new Set(series.flatMap((item) => item.forecast.map((point) => point.month)))].sort();
  return months.map((month) => ({
    month,
    unitsSold: series.reduce((sum, item) => sum + (item.forecast.find((point) => point.month === month)?.unitsSold || 0), 0)
  }));
}

function sumActualSeriesByMonth(series) {
  const months = [...new Set(series.flatMap((item) => item.actuals.map((point) => point.month)))].sort();
  return months.map((month) => ({
    month,
    unitsSold: series.reduce((sum, item) => sum + (item.actuals.find((point) => point.month === month)?.unitsSold || 0), 0)
  }));
}

function buildContributionMonths(series) {
  const months = [...new Set(series.flatMap((item) => item.forecast.map((point) => point.month)))].sort();
  return months.map((month) => ({
    month,
    total: series.reduce((sum, item) => sum + (item.forecast.find((point) => point.month === month)?.unitsSold || 0), 0),
    groups: series.map((item, index) => ({
      groupId: getSeriesId(item),
      groupLabel: getSeriesLabel(item),
      unitsSold: item.forecast.find((point) => point.month === month)?.unitsSold || 0,
      color: getSeriesColor(index, series.length)
    }))
  }));
}

function buildBreakdownLabel(item, domain, breakdownMode) {
  if (domain === "parts") return item.partCategory || item.partId || "Unassigned";
  if (domain === "warranty") {
    if (breakdownMode === "return_reason") return item.returnReason || "Unassigned";
    if (breakdownMode === "age_bucket") return item.ageBucket || "Unassigned";
    return item.claimType || "Unassigned";
  }
  if (breakdownMode === "job_category") return item.jobCategory || "Unassigned";
  return item.serviceType || "Unassigned";
}

function getDomainTitle(domain) {
  if (domain === "parts") return "Parts";
  if (domain === "warranty") return "Warranty";
  return "Service";
}

function aggregateSeriesByBreakdown(series, domain, breakdownMode) {
  const grouped = new Map();
  for (const item of series) {
    const label = buildBreakdownLabel(item, domain, breakdownMode);
    if (!grouped.has(label)) {
      grouped.set(label, {
        ...item,
        groupId: label,
        groupLabel: label,
        seriesKey: label,
        seriesLabel: label,
        forecast: item.forecast.map((point) => ({
          month: point.month,
          unitsSold: 0,
          lower_80: 0,
          upper_80: 0,
          lower_95: 0,
          upper_95: 0,
          lower80WidthSq: 0,
          upper80WidthSq: 0,
          lower95WidthSq: 0,
          upper95WidthSq: 0
        }))
      });
    }

    const aggregate = grouped.get(label);
    item.forecast.forEach((point, index) => {
      const aggregatePoint = aggregate.forecast[index];
      const units = point.unitsSold || 0;
      const lower80 = point.lower_80 ?? units;
      const upper80 = point.upper_80 ?? units;
      const lower95 = point.lower_95 ?? units;
      const upper95 = point.upper_95 ?? units;

      aggregatePoint.unitsSold += units;
      aggregatePoint.lower80WidthSq += Math.max(units - lower80, 0) ** 2;
      aggregatePoint.upper80WidthSq += Math.max(upper80 - units, 0) ** 2;
      aggregatePoint.lower95WidthSq += Math.max(units - lower95, 0) ** 2;
      aggregatePoint.upper95WidthSq += Math.max(upper95 - units, 0) ** 2;
    });
  }
  return [...grouped.values()]
    .map((item) => ({
      ...item,
      forecast: item.forecast.map((point) => ({
        month: point.month,
        unitsSold: point.unitsSold,
        lower_80: Math.max(0, Math.round(point.unitsSold - Math.sqrt(point.lower80WidthSq))),
        upper_80: Math.round(point.unitsSold + Math.sqrt(point.upper80WidthSq)),
        lower_95: Math.max(0, Math.round(point.unitsSold - Math.sqrt(point.lower95WidthSq))),
        upper_95: Math.round(point.unitsSold + Math.sqrt(point.upper95WidthSq))
      }))
    }))
    .sort((left, right) => sumSeries([right]) - sumSeries([left]));
}

function buildValidationRows(series) {
  return series
    .map((item) => ({
      groupId: getSeriesId(item),
      groupLabel: getSeriesLabel(item),
      mae: item.validation?.mae,
      rmse: item.validation?.rmse,
      mape: item.validation?.mape,
      total: sumSeries([item])
    }))
    .sort((left, right) => Number(right.total || 0) - Number(left.total || 0));
}

function buildErrorBuckets(rows) {
  const buckets = [
    { label: "0-5%", min: 0, max: 5, count: 0 },
    { label: "5-10%", min: 5, max: 10, count: 0 },
    { label: "10-15%", min: 10, max: 15, count: 0 },
    { label: "15-25%", min: 15, max: 25, count: 0 },
    { label: "25%+", min: 25, max: Number.POSITIVE_INFINITY, count: 0 }
  ];
  for (const row of rows) {
    const mape = Number(row.mape);
    if (!Number.isFinite(mape)) continue;
    const bucket = buckets.find((item) => mape >= item.min && mape < item.max);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function InfoEyebrow({ children, info }) {
  return (
    <p className="eyebrow info-eyebrow">
      <span>{children}</span>
      <span className="info-tooltip" tabIndex="0" aria-label={info}>
        i
        <span className="info-tooltip-content" role="tooltip">{info}</span>
      </span>
    </p>
  );
}

function ForecastChart({ series, hoveredGroupId, onHoverGroup, intervalMode, unitLabel, message }) {
  if (!series.length) return <div className="empty-chart">{message}</div>;

  const width = 920;
  const height = 360;
  const padding = { top: 24, right: 28, bottom: 68, left: 66 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xAxisLabelY = padding.top + chartHeight + 12;
  const points = series.flatMap((item) => item.forecast);
  const valuesForScale = points.flatMap((point) => [
    point.unitsSold,
    intervalMode === "80" ? point.lower_80 : point.unitsSold,
    intervalMode === "80" ? point.upper_80 : point.unitsSold,
    intervalMode === "95" ? point.lower_95 : point.unitsSold,
    intervalMode === "95" ? point.upper_95 : point.unitsSold
  ]);
  const maxValue = Math.max(...valuesForScale, 1);
  const minValue = Math.min(...valuesForScale, 0);
  const range = Math.max(maxValue - minValue, 1);
  const monthCount = series[0]?.forecast.length || 1;
  const xFor = (index) => padding.left + (index / Math.max(monthCount - 1, 1)) * chartWidth;
  const yFor = (value) => padding.top + chartHeight - ((Number(value || 0) - minValue) / range) * chartHeight;

  return (
    <div className="chart-wrap" aria-label={`${unitLabel} forecast by month`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>{unitLabel} forecast by month</title>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const value = minValue + range * step;
          return (
            <g key={step}>
              <line x1={padding.left} x2={width - padding.right} y1={yFor(value)} y2={yFor(value)} />
              <text x={padding.left - 14} y={yFor(value) + 5} textAnchor="end">{formatUnits(value)}</text>
            </g>
          );
        })}
        {series[0]?.forecast.map((point, index) => (
          <text key={point.month} x={xFor(index)} y={xAxisLabelY} textAnchor="end" transform={`rotate(-90 ${xFor(index)} ${xAxisLabelY})`}>
            {formatChartMonth(point.month)}
          </text>
        ))}
        {series.map((item, itemIndex) => {
          const seriesId = getSeriesId(item);
          const label = getSeriesLabel(item);
          const color = getSeriesColor(itemIndex, series.length);
          const isHovered = hoveredGroupId === seriesId;
          const hasHoveredSeries = Boolean(hoveredGroupId);
          const seriesOpacity = isHovered ? 1 : hasHoveredSeries ? 0.14 : 0.52;
          const bandOpacity = isHovered ? 0.2 : hasHoveredSeries ? 0.04 : 0.08;
          const path = item.forecast.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${xFor(pointIndex)} ${yFor(point.unitsSold)}`).join(" ");
          const buildBandPath = (lowerKey, upperKey) => {
            const upperPath = item.forecast.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${xFor(pointIndex)} ${yFor(point[upperKey] ?? point.unitsSold)}`).join(" ");
            const lowerPath = [...item.forecast].reverse().map((point, reverseIndex) => {
              const pointIndex = item.forecast.length - reverseIndex - 1;
              return `L ${xFor(pointIndex)} ${yFor(point[lowerKey] ?? point.unitsSold)}`;
            }).join(" ");
            return `${upperPath} ${lowerPath} Z`;
          };

          return (
            <g key={seriesId} onMouseEnter={() => onHoverGroup(seriesId)} onMouseLeave={() => onHoverGroup("")}>
              {intervalMode === "95" && <path d={buildBandPath("lower_95", "upper_95")} fill={color} opacity={bandOpacity} stroke="none" />}
              {intervalMode === "80" && <path d={buildBandPath("lower_80", "upper_80")} fill={color} opacity={bandOpacity + 0.08} stroke="none" />}
              <path d={path} stroke={color} strokeWidth={isHovered ? 2 : 1} opacity={seriesOpacity}>
                <title>{label}</title>
              </path>
              {item.forecast.map((point, pointIndex) => (
                <circle key={`${seriesId}-${point.month}`} cx={xFor(pointIndex)} cy={yFor(point.unitsSold)} r={isHovered ? 3 : 2} fill={color} opacity={seriesOpacity}>
                  <title>{`${label}: ${formatUnits(point.unitsSold)} ${unitLabel.toLowerCase()}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TrendChart({ actualTotals, forecastTotals, unitLabel, wide = false }) {
  const width = wide ? 1220 : 920;
  const height = 320;
  const padding = { top: 20, right: 28, bottom: 68, left: 64 };
  const merged = [
    ...actualTotals.map((point) => ({ ...point, kind: "actual" })),
    ...forecastTotals.map((point) => ({ ...point, kind: "forecast" }))
  ];
  if (!merged.length) return <div className="empty-chart">Actual and forecast trend data will appear here when available.</div>;

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...merged.map((point) => point.unitsSold), 1);
  const timeline = [...new Set(merged.map((point) => point.month))].sort();
  const xFor = (index) => padding.left + (index / Math.max(timeline.length - 1, 1)) * chartWidth;
  const yFor = (value) => padding.top + chartHeight - (Number(value || 0) / maxValue) * chartHeight;
  const buildPath = (points) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(timeline.indexOf(point.month))} ${yFor(point.unitsSold)}`).join(" ");

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>{unitLabel} actual versus forecast trend</title>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const y = padding.top + chartHeight - step * chartHeight;
          return (
            <g key={step}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text x={padding.left - 12} y={y + 5} textAnchor="end">{formatUnits(maxValue * step)}</text>
            </g>
          );
        })}
        {timeline.map((month, index) => (
          <text key={month} x={xFor(index)} y={padding.top + chartHeight + 12} textAnchor="end" transform={`rotate(-90 ${xFor(index)} ${padding.top + chartHeight + 12})`}>
            {formatChartMonth(month)}
          </text>
        ))}
        {actualTotals.length > 0 && <path d={buildPath(actualTotals)} stroke="#202020" strokeWidth="3" />}
        {forecastTotals.length > 0 && <path d={buildPath(forecastTotals)} stroke="#00796b" strokeWidth="3" strokeDasharray="8 6" />}
      </svg>
    </div>
  );
}

function ContributionChart({ series, unitLabel, message = "Contribution data will appear here when available.", wide = false }) {
  const months = buildContributionMonths(series);
  const width = wide ? 1220 : 920;
  const height = 320;
  const padding = { top: 20, right: 20, bottom: 68, left: 64 };
  if (!months.length) return <div className="empty-chart">{message}</div>;

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...months.map((month) => month.total), 1);
  const barWidth = (chartWidth / Math.max(months.length, 1)) * 0.68;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>{unitLabel} contribution</title>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const y = padding.top + chartHeight - step * chartHeight;
          return (
            <g key={step}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text x={padding.left - 12} y={y + 5} textAnchor="end">{formatUnits(maxValue * step)}</text>
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
                  <rect key={`${month.month}-${group.groupId}`} x={x} y={y} width={barWidth} height={Math.max(segmentHeight, 1)} fill={group.color} opacity="0.82">
                    <title>{`${group.groupLabel}: ${formatUnits(group.unitsSold)} ${unitLabel.toLowerCase()}`}</title>
                  </rect>
                );
              })}
              <text x={x + barWidth / 2} y={padding.top + chartHeight + 12} textAnchor="end" transform={`rotate(-90 ${x + barWidth / 2} ${padding.top + chartHeight + 12})`}>
                {formatChartMonth(month.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MetricTrendChart({ data, wide = false }) {
  if (!data.length) return <div className="empty-chart">Accuracy trend data will appear after forecasts overlap with actuals.</div>;
  const width = wide ? 1220 : 920;
  const height = 320;
  const padding = { top: 20, right: 28, bottom: 68, left: 64 };
  const metrics = [
    { key: "mape", label: "MAPE", color: "#006d77", formatter: formatPercent },
    { key: "mae", label: "MAE", color: "#8a5a00", formatter: formatUnits },
    { key: "rmse", label: "RMSE", color: "#6a4c93", formatter: formatUnits }
  ];
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...data.flatMap((point) => metrics.map((metric) => Number(point[metric.key] || 0))), 1);
  const xAxisLabelY = padding.top + chartHeight + 12;
  const xFor = (index) => padding.left + (index / Math.max(data.length - 1, 1)) * chartWidth;
  const yFor = (value) => padding.top + chartHeight - (Number(value || 0) / maxValue) * chartHeight;
  const buildPath = (key) => data.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point[key])}`).join(" ");

  return (
    <>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img">
          <title>MAPE, MAE, and RMSE trend</title>
          {[0, 0.25, 0.5, 0.75, 1].map((step) => {
            const y = padding.top + chartHeight - step * chartHeight;
            const value = maxValue * step;
            return (
              <g key={step}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
                <text x={padding.left - 12} y={y + 5} textAnchor="end">{formatDecimal(value, 0)}</text>
              </g>
            );
          })}
          {data.map((point, index) => (
            <text key={point.month} x={xFor(index)} y={xAxisLabelY} textAnchor="end" transform={`rotate(-90 ${xFor(index)} ${xAxisLabelY})`}>
              {formatChartMonth(point.month)}
            </text>
          ))}
          {metrics.map((metric) => (
            <path key={metric.key} d={buildPath(metric.key)} stroke={metric.color} strokeWidth="3">
              <title>{metric.label}</title>
            </path>
          ))}
          {data.map((point, index) =>
            metrics.map((metric) => (
              <circle key={`${point.month}-${metric.key}`} cx={xFor(index)} cy={yFor(point[metric.key])} r="3" fill={metric.color}>
                <title>{`${metric.label}: ${metric.formatter(point[metric.key])}`}</title>
              </circle>
            ))
          )}
        </svg>
      </div>
      <div className="chart-legend">
        {metrics.map((metric) => (
          <span key={metric.key}>
            <i className="legend-line" style={{ borderTopColor: metric.color }} />
            {metric.label}
          </span>
        ))}
      </div>
    </>
  );
}

function BiasChart({ data, wide = false }) {
  if (!data.length) return <div className="empty-chart">Bias data will appear after forecasts overlap with actuals.</div>;
  const width = wide ? 1220 : 920;
  const height = 320;
  const padding = { top: 24, right: 24, bottom: 68, left: 64 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxAbs = Math.max(...data.map((point) => Math.abs(Number(point.bias || 0))), 1);
  const xAxisLabelY = padding.top + chartHeight + 12;
  const zeroY = padding.top + chartHeight / 2;
  const barWidth = (chartWidth / Math.max(data.length, 1)) * 0.58;
  const xFor = (index) => padding.left + (index / data.length) * chartWidth + chartWidth / data.length / 2 - barWidth / 2;
  const yFor = (value) => zeroY - (Number(value || 0) / maxAbs) * (chartHeight / 2);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Forecast bias by month</title>
        <line x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} className="zero-line" />
        {[maxAbs, 0, -maxAbs].map((value) => (
          <text key={value} x={padding.left - 12} y={yFor(value) + 5} textAnchor="end">{formatUnits(value)}</text>
        ))}
        {data.map((point, index) => {
          const value = Number(point.bias || 0);
          const y = value >= 0 ? yFor(value) : zeroY;
          const heightValue = Math.max(Math.abs(yFor(value) - zeroY), 1);
          return (
            <g key={point.month}>
              <rect x={xFor(index)} y={y} width={barWidth} height={heightValue} fill={value >= 0 ? "#b45309" : "#00796b"} opacity="0.84">
                <title>{`${formatChartMonth(point.month)} bias: ${formatUnits(value)} (${formatPercent(point.biasPct)})`}</title>
              </rect>
              <text x={xFor(index) + barWidth / 2} y={xAxisLabelY} textAnchor="end" transform={`rotate(-90 ${xFor(index) + barWidth / 2} ${xAxisLabelY})`}>
                {formatChartMonth(point.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ActualPredictedScatter({ observations, wide = false }) {
  if (!observations.length) return <div className="empty-chart">Matched actual and predicted points will appear here.</div>;
  const width = wide ? 1220 : 460;
  const height = 240;
  const padding = { top: 18, right: 18, bottom: 54, left: 72 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...observations.flatMap((point) => [point.actualUnits, point.forecastUnits].map(Number)), 1);
  const xFor = (value) => padding.left + (Number(value || 0) / maxValue) * chartWidth;
  const yFor = (value) => padding.top + chartHeight - (Number(value || 0) / maxValue) * chartHeight;

  return (
    <div className="chart-wrap compact-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Actual versus predicted scatter</title>
        {[0, 0.5, 1].map((step) => {
          const value = maxValue * step;
          return (
            <g key={step}>
              <line x1={padding.left} x2={width - padding.right} y1={yFor(value)} y2={yFor(value)} />
              <line x1={xFor(value)} x2={xFor(value)} y1={padding.top} y2={height - padding.bottom} />
              <text x={padding.left - 12} y={yFor(value) + 5} textAnchor="end">{formatUnits(value)}</text>
              <text x={xFor(value)} y={height - padding.bottom + 22} textAnchor="middle">{formatUnits(value)}</text>
            </g>
          );
        })}
        <path d={`M ${padding.left} ${height - padding.bottom} L ${width - padding.right} ${padding.top}`} stroke="#2f2f2f" strokeDasharray="7 6" />
        {observations.map((point) => (
          <circle
            key={`${point.groupId}-${point.month}-${point.forecastUnits}-${point.actualUnits}`}
            cx={xFor(point.actualUnits)}
            cy={yFor(point.forecastUnits)}
            r="4"
            fill={Number(point.error || 0) >= 0 ? "#b45309" : "#00796b"}
            opacity="0.62"
          >
            <title>{`${point.groupLabel}, ${formatChartMonth(point.month)}: actual ${formatUnits(point.actualUnits)}, forecast ${formatUnits(point.forecastUnits)}, error ${formatUnits(point.error)}`}</title>
          </circle>
        ))}
        <text x={padding.left + chartWidth / 2} y={height - 8} textAnchor="middle">Actual</text>
        <text x="22" y={padding.top + chartHeight / 2} textAnchor="middle" transform={`rotate(-90 22 ${padding.top + chartHeight / 2})`}>Forecast</text>
      </svg>
    </div>
  );
}

function ErrorHistogram({ buckets, wide = false }) {
  if (!buckets.length) return <div className="empty-chart">Error distribution will appear here.</div>;
  const width = wide ? 1220 : 460;
  const height = 270;
  const padding = { top: 18, right: 18, bottom: 106, left: 52 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const barWidth = (chartWidth / buckets.length) * 0.72;

  return (
    <div className="chart-wrap compact-chart error-histogram-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Error distribution histogram</title>
        {[0, 0.5, 1].map((step) => {
          const y = padding.top + chartHeight - step * chartHeight;
          return (
            <g key={step}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text x={padding.left - 10} y={y + 5} textAnchor="end">{formatUnits(maxCount * step)}</text>
            </g>
          );
        })}
        {buckets.map((bucket, index) => {
          const x = padding.left + (index / buckets.length) * chartWidth + chartWidth / buckets.length / 2 - barWidth / 2;
          const barHeight = (bucket.count / maxCount) * chartHeight;
          const label = `${formatDecimal(bucket.minErrorPct, 0)}-${formatDecimal(bucket.maxErrorPct, 0)}%`;
          return (
            <g key={`${bucket.minErrorPct}-${bucket.maxErrorPct}`}>
              <rect x={x} y={padding.top + chartHeight - barHeight} width={barWidth} height={Math.max(barHeight, 1)} fill="#6a4c93" opacity="0.78">
                <title>{`${label}: ${formatUnits(bucket.count)} records`}</title>
              </rect>
              <text
                x={x + barWidth / 2}
                y={padding.top + chartHeight + 16}
                textAnchor="end"
                transform={`rotate(-90 ${x + barWidth / 2} ${padding.top + chartHeight + 16})`}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Leaderboard({ rows, unitLabel }) {
  const visibleRows = rows.slice(0, 12);
  if (!visibleRows.length) return <div className="empty-chart">Leaderboard data will appear after forecast data is available.</div>;
  const maxValue = Math.max(...visibleRows.map((row) => Number(row.total ?? row.sampleCount ?? 0)), 1);

  return (
    <div className="leaderboard-list">
      {visibleRows.map((row, index) => (
        <div key={row.groupId} className="leaderboard-row">
          <div>
            <strong>{index + 1}. {row.groupLabel}</strong>
            <span>MAE {formatDecimal(row.mae)} | RMSE {formatDecimal(row.rmse)} | MAPE {formatPercent(row.mape)}</span>
          </div>
          <div className="leaderboard-bar" aria-hidden="true">
            <i style={{ width: `${Math.max((Number(row.total ?? row.sampleCount ?? 0) / maxValue) * 100, 3)}%` }} />
          </div>
          <strong>{row.total === undefined ? `${formatUnits(row.sampleCount)} samples` : `${formatUnits(row.total)} ${unitLabel.toLowerCase()}`}</strong>
        </div>
      ))}
    </div>
  );
}

function KpiMetric({ label, value, detail }) {
  return (
    <article className="kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export default function DomainForecastPage({ domain }) {
  const { apiFetch, user } = useAuth();
  const isParts = domain === "parts";
  const isWarranty = domain === "warranty";
  const domainTitle = getDomainTitle(domain);
  const unitLabel = isParts ? "Units" : isWarranty ? "Claims / Returns" : "Orders";
  const domainAccessScopes = useMemo(
    () => (user?.accessScopes || []).filter((scope) => scope.domain === domainTitle),
    [domainTitle, user?.accessScopes]
  );
  const isServiceCenterScopedManager =
    domainAccessScopes.length > 0 &&
    domainAccessScopes.every((scope) => scope.type === "Service Center");
  const availableLevels = useMemo(
    () => (isServiceCenterScopedManager ? forecastLevels.filter((option) => option.value === "service_center") : forecastLevels),
    [isServiceCenterScopedManager]
  );
  const [level, setLevel] = useState(() => (isServiceCenterScopedManager ? "service_center" : "zone"));
  const [serviceCenterId, setServiceCenterId] = useState("");
  const [stateId, setStateId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [horizonMonths, setHorizonMonths] = useState(6);
  const [partCategory, setPartCategory] = useState("");
  const [partId, setPartId] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [jobCategory, setJobCategory] = useState("");
  const [claimType, setClaimType] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [ageBucket, setAgeBucket] = useState("");
  const [intervalMode, setIntervalMode] = useState("point");
  const [hoveredGroupId, setHoveredGroupId] = useState("");
  const [hoveredBreakdownId, setHoveredBreakdownId] = useState("");
  const [referenceState, setReferenceState] = useState({ loading: true, error: "", serviceCenters: [], parts: [], serviceTypes: [], jobCategories: [], claimTypes: [], returnReasons: [], ageBuckets: [] });
  const [forecastState, setForecastState] = useState({ loading: true, error: "", series: [] });
  const [actualState, setActualState] = useState({ loading: true, error: "", series: [] });
  const [breakdownState, setBreakdownState] = useState({ loading: true, error: "", series: [] });
  const [diagnosticsState, setDiagnosticsState] = useState({ loading: true, error: "", trend: [], observations: [], buckets: [], leaderboard: [] });
  const [kpiState, setKpiState] = useState({ loading: true, error: "", kpis: {} });
  const [dashboardCardState, setDashboardCardState] = useState({
    loading: true,
    error: "",
    visibility: { ...defaultDashboardCardVisibility }
  });
  const [activeSection, setActiveSection] = useState(() => resolveDomainSection(domain, window.location.hash));
  const currentMonthStart = useMemo(() => getCurrentMonthStart(), []);

  useEffect(() => {
    function handleHashChange() {
      setActiveSection(resolveDomainSection(domain, window.location.hash));
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [domain]);

  useEffect(() => {
    const controller = new AbortController();
    const dashboardDomain = domainTitle;

    async function loadDashboardCards() {
      try {
        const response = await apiFetch(`/api/v1/forecasts/dashboard-cards?domain=${dashboardDomain}`, {
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load dashboard card settings.");

        setDashboardCardState({
          loading: false,
          error: "",
          visibility: buildDashboardCardVisibility(payload.cards || [])
        });
      } catch (error) {
        if (error.name === "AbortError") return;
        setDashboardCardState({
          loading: false,
          error: error.message || "Unable to load dashboard card settings.",
          visibility: { ...defaultDashboardCardVisibility }
        });
      }
    }

    loadDashboardCards();
    window.addEventListener("dashboard-card-settings-changed", loadDashboardCards);

    return () => {
      controller.abort();
      window.removeEventListener("dashboard-card-settings-changed", loadDashboardCards);
    };
  }, [apiFetch, domainTitle]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadReferences() {
      try {
        const response = await apiFetch(`/api/v1/forecasts/${domain}/references`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load reference data.");
        setReferenceState({
          loading: false,
          error: "",
          serviceCenters: payload.serviceCenters || [],
          parts: payload.parts || [],
          serviceTypes: payload.serviceTypes || [],
          jobCategories: payload.jobCategories || [],
          claimTypes: payload.claimTypes || [],
          returnReasons: payload.returnReasons || [],
          ageBuckets: payload.ageBuckets || []
        });
      } catch (error) {
        if (error.name === "AbortError") return;
        setReferenceState({ loading: false, error: error.message || "Unable to load reference data.", serviceCenters: [], parts: [], serviceTypes: [], jobCategories: [], claimTypes: [], returnReasons: [], ageBuckets: [] });
      }
    }
    loadReferences();
    return () => controller.abort();
  }, [apiFetch, domain]);

  const serviceCenters = referenceState.serviceCenters;
  const states = useMemo(() => [...new Set(serviceCenters.map((center) => center.state).filter(Boolean))].sort(), [serviceCenters]);
  const zones = useMemo(() => [...new Set(serviceCenters.map((center) => center.region).filter(Boolean))].sort(), [serviceCenters]);
  const partCategories = useMemo(() => [...new Set(referenceState.parts.map((part) => part.category).filter(Boolean))].sort(), [referenceState.parts]);
  const filteredParts = useMemo(() => (partCategory ? referenceState.parts.filter((part) => part.category === partCategory) : referenceState.parts), [partCategory, referenceState.parts]);
  const groupId = level === "service_center" ? serviceCenterId : level === "state" ? stateId : zoneId;
  const selectedRegionLabel = level === "zone" ? zoneId : level === "state" ? stateId : serviceCenterId;
  const scopeLabel = selectedRegionLabel || (level === "zone" ? "All zones" : level === "state" ? "All states" : "All service centers");
  const productLabel = isParts
    ? partId || partCategory || "All parts"
    : isWarranty
      ? claimType || returnReason || ageBucket || "All warranty and returns"
      : serviceType || jobCategory || "All service orders";
  const activeLevelLabel = forecastLevels.find((item) => item.value === level)?.label || "Group";
  const breakdownMode = isParts ? "part_category" : isWarranty ? (claimType ? (returnReason ? "age_bucket" : "return_reason") : "claim_type") : serviceType ? "job_category" : "service_type";

  useEffect(() => {
    if (isServiceCenterScopedManager) {
      setLevel("service_center");
      setServiceCenterId(user?.serviceCenterId || referenceState.serviceCenters[0]?.id || "");
      setStateId("");
      setZoneId("");
      return;
    }

    if (!availableLevels.some((option) => option.value === level)) {
      setLevel(availableLevels[0]?.value || "zone");
    }
  }, [availableLevels, isServiceCenterScopedManager, level, referenceState.serviceCenters, user?.serviceCenterId]);

  useEffect(() => {
    if (partId && !filteredParts.some((part) => part.id === partId)) setPartId("");
  }, [filteredParts, partId]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadForecast() {
      setForecastState((current) => ({ ...current, loading: true, error: "" }));
      setActualState((current) => ({ ...current, loading: true, error: "" }));
      try {
        const params = new URLSearchParams();
        params.set("level", level);
        params.set("startDate", currentMonthStart);
        params.set("horizon", String(horizonMonths));
        if (groupId) params.set("groupId", groupId);
        if (isParts) {
          if (partCategory) params.set("partCategory", partCategory);
          if (partId) params.set("partId", partId);
        } else if (isWarranty) {
          if (claimType) params.set("claimType", claimType);
          if (returnReason) params.set("returnReason", returnReason);
          if (ageBucket) params.set("ageBucket", ageBucket);
        } else {
          if (serviceType) params.set("serviceType", serviceType);
          if (jobCategory) params.set("jobCategory", jobCategory);
        }

        const [response, actualResponse] = await Promise.all([
          apiFetch(`/api/v1/forecasts/${domain}?${params}`, { signal: controller.signal }),
          apiFetch(`/api/v1/forecasts/${domain}/actuals?${params}`, { signal: controller.signal })
        ]);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load forecast data.");
        const actualPayload = actualResponse.ok ? await actualResponse.json() : { series: [] };
        setForecastState({ loading: false, error: "", series: payload.series || [] });
        setActualState({ loading: false, error: "", series: actualPayload.series || [] });
      } catch (error) {
        if (error.name === "AbortError") return;
        setForecastState({ loading: false, error: error.message || "Unable to load forecast data.", series: [] });
        setActualState({ loading: false, error: "", series: [] });
      }
    }
    loadForecast();
    return () => controller.abort();
  }, [ageBucket, apiFetch, claimType, currentMonthStart, domain, groupId, horizonMonths, isParts, isWarranty, jobCategory, level, partCategory, partId, returnReason, serviceType]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadKpis() {
      if (activeSection !== "monitor") {
        setKpiState({ loading: false, error: "", kpis: {} });
        return;
      }

      setKpiState({ loading: true, error: "", kpis: {} });
      try {
        const params = new URLSearchParams();
        params.set("level", level);
        params.set("startDate", currentMonthStart);
        params.set("horizon", String(horizonMonths));
        if (groupId) params.set("groupId", groupId);
        if (isParts) {
          if (partCategory) params.set("partCategory", partCategory);
          if (partId) params.set("partId", partId);
        } else if (isWarranty) {
          if (claimType) params.set("claimType", claimType);
          if (returnReason) params.set("returnReason", returnReason);
          if (ageBucket) params.set("ageBucket", ageBucket);
        } else {
          if (serviceType) params.set("serviceType", serviceType);
          if (jobCategory) params.set("jobCategory", jobCategory);
        }

        const response = await apiFetch(`/api/v1/forecasts/${domain}/kpis?${params}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load KPI data.");
        setKpiState({ loading: false, error: "", kpis: payload.kpis || {} });
      } catch (error) {
        if (error.name === "AbortError") return;
        setKpiState({ loading: false, error: error.message || "Unable to load KPI data.", kpis: {} });
      }
    }
    loadKpis();
    return () => controller.abort();
  }, [activeSection, ageBucket, apiFetch, claimType, currentMonthStart, domain, groupId, horizonMonths, isParts, isWarranty, jobCategory, level, partCategory, partId, returnReason, serviceType]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadBreakdown() {
      if (activeSection !== "monitor" && activeSection !== "data") {
        setBreakdownState({ loading: false, error: "", series: [] });
        return;
      }

      setBreakdownState({ loading: true, error: "", series: [] });
      try {
        const params = new URLSearchParams();
        params.set("level", level);
        params.set("startDate", currentMonthStart);
        params.set("horizon", String(horizonMonths));
        params.set("breakdown", breakdownMode);
        if (groupId) params.set("groupId", groupId);
        if (isParts) {
          if (partCategory) params.set("partCategory", partCategory);
          if (partId) params.set("partId", partId);
        } else if (isWarranty) {
          if (claimType) params.set("claimType", claimType);
          if (returnReason) params.set("returnReason", returnReason);
          if (ageBucket) params.set("ageBucket", ageBucket);
        } else {
          if (serviceType) params.set("serviceType", serviceType);
          if (jobCategory) params.set("jobCategory", jobCategory);
        }

        const response = await apiFetch(`/api/v1/forecasts/${domain}?${params}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load breakdown data.");
        setBreakdownState({ loading: false, error: "", series: payload.series || [] });
      } catch (error) {
        if (error.name === "AbortError") return;
        setBreakdownState({ loading: false, error: error.message || "Unable to load breakdown data.", series: [] });
      }
    }
    loadBreakdown();
    return () => controller.abort();
  }, [activeSection, ageBucket, apiFetch, breakdownMode, claimType, currentMonthStart, domain, groupId, horizonMonths, isParts, isWarranty, jobCategory, level, partCategory, partId, returnReason, serviceType]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadDiagnostics() {
      if (activeSection !== "diagnostics" && activeSection !== "leaderboard") {
        setDiagnosticsState({ loading: false, error: "", trend: [], observations: [], buckets: [], leaderboard: [] });
        return;
      }

      setDiagnosticsState({ loading: true, error: "", trend: [], observations: [], buckets: [], leaderboard: [] });
      try {
        const params = new URLSearchParams();
        params.set("level", level);
        params.set("window", String(Math.min(horizonMonths, 24)));
        params.set("limit", "500");
        if (groupId) params.set("groupId", groupId);
        if (isParts) {
          if (partCategory) params.set("partCategory", partCategory);
          if (partId) params.set("partId", partId);
        } else if (isWarranty) {
          if (claimType) params.set("claimType", claimType);
          if (returnReason) params.set("returnReason", returnReason);
          if (ageBucket) params.set("ageBucket", ageBucket);
        } else {
          if (serviceType) params.set("serviceType", serviceType);
          if (jobCategory) params.set("jobCategory", jobCategory);
        }

        const response = await apiFetch(`/api/v1/forecasts/${domain}/diagnostics?${params}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load forecast diagnostics.");
        setDiagnosticsState({
          loading: false,
          error: "",
          trend: payload.trend || [],
          observations: payload.observations || [],
          buckets: payload.buckets || [],
          leaderboard: payload.leaderboard || []
        });
      } catch (error) {
        if (error.name === "AbortError") return;
        setDiagnosticsState({ loading: false, error: error.message || "Unable to load forecast diagnostics.", trend: [], observations: [], buckets: [], leaderboard: [] });
      }
    }
    loadDiagnostics();
    return () => controller.abort();
  }, [activeSection, ageBucket, apiFetch, claimType, domain, groupId, horizonMonths, isParts, isWarranty, jobCategory, level, partCategory, partId, returnReason, serviceType]);

  const visibleSeries = forecastState.series;
  const visibleBreakdownSeries = useMemo(
    () => aggregateSeriesByBreakdown(breakdownState.series, domain, breakdownMode),
    [breakdownMode, breakdownState.series, domain]
  );
  const forecastTotals = useMemo(() => sumSeriesByMonth(visibleSeries), [visibleSeries]);
  const actualTotals = useMemo(() => sumActualSeriesByMonth(actualState.series), [actualState.series]);
  const validationRows = useMemo(() => buildValidationRows(visibleSeries), [visibleSeries]);
  const diagnosticsRows = diagnosticsState.leaderboard.length ? diagnosticsState.leaderboard : validationRows;
  const errorBuckets = diagnosticsState.buckets;
  const hasForecastData = visibleSeries.length > 0;
  const hasBreakdownData = visibleBreakdownSeries.length > 0;
  const summary = hasForecastData ? summarizeSeries(visibleSeries) : { total: 0, firstMonth: 0, lastMonth: 0, growth: 0, leader: null };
  const breakdownSummary = hasBreakdownData ? summarizeSeries(visibleBreakdownSeries) : { total: 0, growth: 0, leader: null };
  const avgWidth80 = hasForecastData ? summarizeUncertainty(visibleSeries, "80") : 0;
  const avgWidth95 = hasForecastData ? summarizeUncertainty(visibleSeries, "95") : 0;
  const chartMessage = forecastState.loading ? "Loading live forecast data..." : forecastState.error || "No forecast data is available for the selected filters.";
  const breakdownMessage = breakdownState.loading ? "Loading breakdown data..." : breakdownState.error || "No breakdown data is available for the selected filters.";
  const cards = dashboardCardState.visibility;
  const showForecastAnalytics = cards.trend || cards.segmentSplit;
  const showForecastCharts = cards.forecastGraph || cards.regionalSegmentSplit;
  const showAccuracyDiagnostics = cards.accuracyTrend || cards.biasTrend;
  const showErrorDiagnostics = cards.actualPredicted || cards.errorDistribution;
  const showAftersalesKpis =
    (isParts && cards.fillRate) ||
    (!isParts && !isWarranty && cards.mttr) ||
    (isWarranty && cards.returnRate) ||
    cards.serviceCostActualVsForecast;
  const costKpi = kpiState.kpis.serviceCostActualVsForecast || {};
  const costVariance = costKpi.variance;
  const costVarianceLabel = costVariance === null || costVariance === undefined
    ? "Variance pending forecast baseline"
    : `${costVariance >= 0 ? "+" : ""}${formatCurrency(costVariance)} vs forecast`;
  const activeSectionLabel = {
    monitor: "Forecast Monitor",
    diagnostics: "Diagnostics",
    leaderboard: "Leaderboard",
    data: "Forecast Data"
  }[activeSection];

  return (
    <section className="forecast-ops-shell">
      <div className="forecast-ops-main">
        <section className="forecast-ops-header">
          <div>
            <p className="eyebrow">{domainTitle} Dashboard</p>
            <h1>{activeSectionLabel}</h1>
            <p>{scopeLabel} · {productLabel}</p>
          </div>
          <div className="forecast-ops-status">
            <div className="interval-toggle-group header-interval-toggle" aria-label="Prediction interval display options">
              <label><input type="radio" name={`${domain}-interval-mode`} value="point" checked={intervalMode === "point"} onChange={() => setIntervalMode("point")} />Point only</label>
              <label><input type="radio" name={`${domain}-interval-mode`} value="80" checked={intervalMode === "80"} onChange={() => setIntervalMode("80")} />80% band</label>
              <label><input type="radio" name={`${domain}-interval-mode`} value="95" checked={intervalMode === "95"} onChange={() => setIntervalMode("95")} />95% band</label>
            </div>
          </div>
        </section>

        {referenceState.error && <DismissibleMessage onClose={() => setReferenceState((current) => ({ ...current, error: "" }))}>{referenceState.error}</DismissibleMessage>}
        {forecastState.error && <DismissibleMessage onClose={() => setForecastState((current) => ({ ...current, error: "" }))}>{forecastState.error}</DismissibleMessage>}
        {actualState.error && <DismissibleMessage onClose={() => setActualState((current) => ({ ...current, error: "" }))}>{actualState.error}</DismissibleMessage>}
        {breakdownState.error && <DismissibleMessage onClose={() => setBreakdownState((current) => ({ ...current, error: "" }))}>{breakdownState.error}</DismissibleMessage>}
        {diagnosticsState.error && <DismissibleMessage onClose={() => setDiagnosticsState((current) => ({ ...current, error: "" }))}>{diagnosticsState.error}</DismissibleMessage>}
        {kpiState.error && <DismissibleMessage onClose={() => setKpiState((current) => ({ ...current, error: "" }))}>{kpiState.error}</DismissibleMessage>}
        {dashboardCardState.error && <DismissibleMessage onClose={() => setDashboardCardState((current) => ({ ...current, error: "" }))}>{dashboardCardState.error}</DismissibleMessage>}

        <section className="controls-band forecast-ops-toolbar">
          <div className="controls-row">
            <label>
              Forecast level
              <select value={level} onChange={(event) => setLevel(event.target.value)}>
                {availableLevels.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>

            {level === "service_center" && (
              <label>
                Service Center
                <select value={serviceCenterId} onChange={(event) => setServiceCenterId(event.target.value)} disabled={referenceState.loading}>
                  <option value="">All service centers</option>
                  {serviceCenters.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
                </select>
              </label>
            )}

            {level === "state" && (
              <label>
                State
                <select value={stateId} onChange={(event) => setStateId(event.target.value)} disabled={referenceState.loading}>
                  <option value="">All states</option>
                  {states.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </label>
            )}

            {level === "zone" && (
              <label>
                Zone
                <select value={zoneId} onChange={(event) => setZoneId(event.target.value)} disabled={referenceState.loading}>
                  <option value="">All zones</option>
                  {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
              </label>
            )}

            <label>
              Forecast months
              <select value={horizonMonths} onChange={(event) => setHorizonMonths(Number(event.target.value))}>
                {forecastHorizons.map((months) => <option key={months} value={months}>{months} months</option>)}
              </select>
            </label>

            {isParts ? (
              <>
                <label>
                  Part Category
                  <select value={partCategory} onChange={(event) => setPartCategory(event.target.value)} disabled={referenceState.loading}>
                    <option value="">All categories</option>
                    {partCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
                <label>
                  Part
                  <select value={partId} onChange={(event) => setPartId(event.target.value)} disabled={referenceState.loading}>
                    <option value="">All parts</option>
                    {filteredParts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                  </select>
                </label>
              </>
            ) : isWarranty ? (
              <>
                <label>
                  Claim Type
                  <select value={claimType} onChange={(event) => setClaimType(event.target.value)} disabled={referenceState.loading}>
                    <option value="">All claim types</option>
                    {referenceState.claimTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label>
                  Return Reason
                  <select value={returnReason} onChange={(event) => setReturnReason(event.target.value)} disabled={referenceState.loading}>
                    <option value="">All return reasons</option>
                    {referenceState.returnReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                  </select>
                </label>
                <label>
                  Age Bucket
                  <select value={ageBucket} onChange={(event) => setAgeBucket(event.target.value)} disabled={referenceState.loading}>
                    <option value="">All age buckets</option>
                    {referenceState.ageBuckets.map((bucket) => <option key={bucket} value={bucket}>{bucket}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Service Type
                  <select value={serviceType} onChange={(event) => setServiceType(event.target.value)} disabled={referenceState.loading}>
                    <option value="">All service types</option>
                    {referenceState.serviceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label>
                  Job Category
                  <select value={jobCategory} onChange={(event) => setJobCategory(event.target.value)} disabled={referenceState.loading}>
                    <option value="">All job categories</option>
                    {referenceState.jobCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
              </>
            )}
          </div>
        </section>

        {activeSection === "monitor" && (
          <>
            <section className="summary-grid forecast-summary-grid forecast-ops-summary" aria-label={`${domain} forecast summary`}>
              <article className="metric"><span>{horizonMonths}-month forecast</span><strong>{hasForecastData ? formatUnits(summary.total) : "No data"}</strong><p>{unitLabel.toLowerCase()} matching current filters</p></article>
              <article className="metric"><span>Run rate change</span><strong>{hasForecastData ? `${summary.growth >= 0 ? "+" : ""}${summary.growth.toFixed(1)}%` : "No data"}</strong><p>{hasForecastData ? `${formatUnits(summary.firstMonth)} to ${formatUnits(summary.lastMonth)} ${unitLabel.toLowerCase()}` : "Waiting for forecast data"}</p></article>
              <article className="metric"><span>Leading group</span><strong>{hasForecastData ? summary.leader?.groupLabel : "No data"}</strong><p>{activeLevelLabel}</p></article>
              <article className="metric"><span>Avg uncertainty band</span><strong>{hasForecastData && intervalMode !== "point" ? formatUnits(intervalMode === "95" ? avgWidth95 : avgWidth80) : "Point only"}</strong><p>{intervalMode === "point" ? "Switch interval mode to inspect uncertainty" : `${intervalMode}% interval width average`}</p></article>
              <article className="metric"><span>Open exceptions</span><strong>{validationRows.filter((row) => Number(row.mape || 0) > 12).length}</strong><p>Groups above 12% MAPE in the current view</p></article>
              <article className="metric"><span>Visible series</span><strong>{visibleSeries.length}</strong><p>{activeLevelLabel.toLowerCase()} rows matching filters</p></article>
            </section>

            {showAftersalesKpis && (
            <section className="forecast-kpi-band" aria-label={`${domain} aftersales KPI summary`}>
              {isParts && cards.fillRate && (
                <KpiMetric
                  label="Fill Rate"
                  value={kpiState.loading ? "Loading" : formatPercent(kpiState.kpis.fillRate?.value)}
                  detail={`${formatUnits(kpiState.kpis.fillRate?.numerator)} fulfilled of ${formatUnits(kpiState.kpis.fillRate?.denominator)} demanded`}
                />
              )}
              {!isParts && !isWarranty && cards.mttr && (
                <KpiMetric
                  label="MTTR"
                  value={kpiState.loading ? "Loading" : `${formatDecimal(kpiState.kpis.mttr?.value)} days`}
                  detail={`${formatUnits(kpiState.kpis.mttr?.sampleCount)} completed orders in the KPI window`}
                />
              )}
              {isWarranty && cards.returnRate && (
                <KpiMetric
                  label="Return Rate"
                  value={kpiState.loading ? "Loading" : formatPercent(kpiState.kpis.returnRate?.value)}
                  detail={`${formatUnits(kpiState.kpis.returnRate?.numerator)} returns of ${formatUnits(kpiState.kpis.returnRate?.denominator)} claim and return records`}
                />
              )}
              {cards.serviceCostActualVsForecast && (
                <KpiMetric
                  label="Service Cost Actuals vs Forecast"
                  value={kpiState.loading ? "Loading" : formatCurrency(costKpi.actual)}
                  detail={kpiState.loading ? "Loading cost baseline" : costVarianceLabel}
                />
              )}
            </section>
            )}

            {showForecastAnalytics && (
            <section className="analytics-grid" aria-label={`${domain} forecast analytics`}>
              {cards.trend && (
              <article className={`analytics-panel ${!cards.segmentSplit ? "full-width-panel" : ""}`}>
                <div className="panel-heading compact">
                  <div>
                    <InfoEyebrow info={`Shows the total ${unitLabel.toLowerCase()} forecast path across visible groups.`}>Trend</InfoEyebrow>
                    <h2>{unitLabel} forecast trend</h2>
                  </div>
                </div>
                <TrendChart actualTotals={actualTotals} forecastTotals={forecastTotals} unitLabel={unitLabel} />
              </article>
              )}
              {cards.segmentSplit && (
              <article className={`analytics-panel ${!cards.trend ? "full-width-panel" : ""}`}>
                <div className="panel-heading compact">
                  <div>
                    <InfoEyebrow info={isParts ? "Shows how the selected forecast is distributed across part categories." : isWarranty ? "Shows how the selected forecast is distributed across warranty claim and return segments." : "Shows how the selected forecast is distributed across service segments."}>Segment split</InfoEyebrow>
                    <h2>{isParts ? `Forecast by part category for ${scopeLabel}` : isWarranty ? `Forecast by warranty segment for ${scopeLabel}` : `Forecast by service segment for ${scopeLabel}`}</h2>
                    <p className="panel-subcopy">{hasBreakdownData ? `${breakdownSummary.leader?.groupLabel || "Top group"} leads this view.` : "Waiting for breakdown data."}</p>
                  </div>
                </div>
                <ContributionChart series={visibleBreakdownSeries} unitLabel={unitLabel} message={breakdownMessage} />
              </article>
              )}
            </section>
            )}

            {showForecastCharts && (
            <section className="forecast-chart-pair" aria-label={`${domain} forecast graph and regional segment split`}>
              {cards.forecastGraph && (
              <article className={`forecast-panel ${!cards.regionalSegmentSplit ? "full-width-panel" : ""}`}>
                <div className="panel-heading">
                  <div>
                    <InfoEyebrow info="Shows the monthly forecast for the selected level and filters. Use the interval selector in the page header to switch between point forecast and uncertainty bands.">Forecast graph</InfoEyebrow>
                    <h2>Monthly {unitLabel.toLowerCase()} by {activeLevelLabel.toLowerCase()}</h2>
                  </div>
                  <div className="panel-pill-group"><span className="source-pill interval-context">{intervalMode === "point" ? "Point only" : `${intervalMode}% band`}</span></div>
                </div>
                <ForecastChart series={visibleSeries} hoveredGroupId={hoveredGroupId} onHoverGroup={setHoveredGroupId} intervalMode={intervalMode} unitLabel={unitLabel} message={chartMessage} />
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
              </article>
              )}
              {cards.regionalSegmentSplit && (
              <article className={`forecast-panel ${!cards.forecastGraph ? "full-width-panel" : ""}`}>
                <div className="panel-heading">
                  <div>
                    <InfoEyebrow info={isParts ? "Shows part-category forecast lines within the selected region or scope. Use it to compare expected demand movement by category." : isWarranty ? "Shows warranty and return segment forecast lines within the selected region or scope." : "Shows service-segment forecast lines within the selected region or scope. Use it to compare expected order movement by service segment."}>Regional segment split</InfoEyebrow>
                    <h2>{isParts ? `Part categories within ${scopeLabel}` : isWarranty ? `Warranty segments within ${scopeLabel}` : `Service segments within ${scopeLabel}`}</h2>
                    <p className="panel-subcopy">{productLabel}</p>
                  </div>
                  <div className="panel-pill-group"><span className="source-pill interval-context">{intervalMode === "point" ? "Point only" : `${intervalMode}% band`}</span></div>
                </div>
                <ForecastChart series={visibleBreakdownSeries} hoveredGroupId={hoveredBreakdownId} onHoverGroup={setHoveredBreakdownId} intervalMode={intervalMode} unitLabel={unitLabel} message={breakdownMessage} />
                {hasBreakdownData && (
                  <div className="legend">
                    {visibleBreakdownSeries.slice(0, 18).map((item, index) => (
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
              </article>
              )}
            </section>
            )}
          </>
        )}

        {activeSection === "diagnostics" && (
          <>
            {showAccuracyDiagnostics && (
            <section className="analytics-grid" aria-label={`${domain} diagnostics`}>
              {cards.accuracyTrend && (
              <article className={`analytics-panel ${!cards.biasTrend ? "full-width-panel" : ""}`}>
                <div className="panel-heading compact"><div><InfoEyebrow info="Tracks forecast accuracy measures over time. Lower MAPE, MAE, and RMSE indicate better historical forecast performance.">Accuracy</InfoEyebrow><h2>MAPE / MAE / RMSE trend</h2><p className="panel-subcopy">Rolling matched actuals for {scopeLabel}</p></div></div>
                <MetricTrendChart data={diagnosticsState.trend} />
              </article>
              )}
              {cards.biasTrend && (
              <article className={`analytics-panel ${!cards.accuracyTrend ? "full-width-panel" : ""}`}>
                <div className="panel-heading compact"><div><InfoEyebrow info="Shows whether forecasts have historically been above or below actuals. Positive values indicate over-forecasting; negative values indicate under-forecasting.">Bias</InfoEyebrow><h2>Forecast bias by month</h2><p className="panel-subcopy">Positive bars are over-forecast, negative bars are under-forecast.</p></div></div>
                <BiasChart data={diagnosticsState.trend} />
              </article>
              )}
            </section>
            )}
            {showErrorDiagnostics && (
            <section className="analytics-grid" aria-label={`${domain} error diagnostics`}>
              {cards.actualPredicted && (
              <article className={`analytics-panel ${!cards.errorDistribution ? "full-width-panel" : ""}`}>
                <div className="panel-heading compact"><div><InfoEyebrow info="Plots actual units against predicted units. Points closer to the diagonal line indicate better calibration.">Calibration</InfoEyebrow><h2>Actual vs predicted</h2></div></div>
                <ActualPredictedScatter observations={diagnosticsState.observations} />
              </article>
              )}
              {cards.errorDistribution && (
              <article className={`analytics-panel ${!cards.actualPredicted ? "full-width-panel" : ""}`}>
                <div className="panel-heading compact"><div><InfoEyebrow info="Buckets matched observations by percentage forecast error.">Error spread</InfoEyebrow><h2>Error distribution</h2></div></div>
                <ErrorHistogram buckets={errorBuckets} />
              </article>
              )}
            </section>
            )}
          </>
        )}

        {activeSection === "leaderboard" && cards.leaderboard && (
          <section className="forecast-panel">
            <div className="panel-heading">
              <div>
                <InfoEyebrow info="Ranks visible groups by forecast volume and includes validation metrics from the latest run.">Leaderboard</InfoEyebrow>
                <h2>Forecast leaderboard by {activeLevelLabel.toLowerCase()}</h2>
              </div>
            </div>
            <Leaderboard rows={diagnosticsRows} unitLabel={unitLabel} />
          </section>
        )}

        {activeSection === "data" && (
          <>
            {cards.segmentBreakdown && hasBreakdownData && (
            <section className="data-table" aria-label={`${domain} segment breakdown data table`}>
              <div className="panel-heading compact">
                <div>
                  <InfoEyebrow info="Monthly forecast values by segment, including interval ranges when an uncertainty band is selected.">Segment breakdown</InfoEyebrow>
                  <h2>Next {horizonMonths} months for {scopeLabel}</h2>
                </div>
                <span className="source-pill interval-context">{getBandLabel(intervalMode)}</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Segment</th>
                      {visibleBreakdownSeries[0]?.forecast.map((point) => <th key={point.month}>{formatMonth(point.month)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBreakdownSeries.slice(0, 150).map((item) => (
                      <tr key={getSeriesId(item)}>
                        <th>{getSeriesLabel(item)}</th>
                        {item.forecast.map((point) => (
                          <td key={point.month}>
                            <strong>{formatUnits(point.unitsSold)}</strong>
                            {intervalMode !== "point" && (
                              <small>
                                {intervalMode === "80"
                                  ? `${formatUnits(point.lower_80)}-${formatUnits(point.upper_80)}`
                                  : `${formatUnits(point.lower_95)}-${formatUnits(point.upper_95)}`}
                              </small>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            )}
            {cards.forecastData && (
            <section className="data-table" aria-label={`${domain} forecast data table`}>
              <div className="panel-heading compact"><div><InfoEyebrow info="Monthly forecast values for each visible group matching the selected filters.">Forecast data</InfoEyebrow><h2>Next {horizonMonths} months</h2></div></div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{activeLevelLabel}</th>
                      {visibleSeries[0]?.forecast.map((point) => <th key={point.month}>{formatMonth(point.month)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSeries.slice(0, 150).map((item, index) => (
                      <tr key={`${getSeriesId(item)}-${index}`}>
                        <th>{getSeriesLabel(item)}</th>
                        {item.forecast.map((point) => <td key={point.month}>{formatUnits(point.unitsSold)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}
