# Forecasting Methodology

## Purpose

The baseline forecast estimates future monthly vehicle sales using historical
`monthly_sales_data.units_sold`. It produces forecasts at three hierarchy levels:

- Dealerwise: one series per dealer.
- Statewise: one series per state.
- Zonewise: one series per region or zone.

The nightly worker stores the generated values in `forecast_runs` and
`forecast_data`, and the API returns the latest completed stored forecast.
The hierarchy is reconciled, which means dealerwise totals, statewise totals,
and zonewise totals match exactly for the same scope and forecast month.
Active festive-event uplifts are loaded from `forecast_event_calendar` and
applied during the nightly refresh.

The platform also produces separate aftersales forecasts:

- Parts demand forecasting for slow-moving and intermittent spare-parts demand.
- Service order volume forecasting for workshop capacity planning.
- Warranty and returns forecasting for expected claim and return volume.
- SLA breach risk forecasting for expected service categories at risk of SLA
  misses.

Those aftersales domains are stored independently from the sales forecast but
share the same run tracking table, permission model, event calendar, and
dashboard conventions.

## Data Preparation

For each forecast request, the system first aggregates historical sales only at
dealer level, keeping the dealer's state and zone attributes.

Optional `modelId` and `variantId` filters are applied before aggregation. The
worker creates forecasts for three scope types:

- Overall forecast: no model or variant filter.
- Model forecast: filtered by each distinct `model_id`.
- Variant forecast: filtered by each distinct `model_id` and `variant_id`.

After aggregation, the code builds a continuous monthly time series from the
first available month to the last available month. If a group has no sales in a
month inside that range, the missing month is filled as `0` units.

Statewise and zonewise results are not forecast independently. They are derived
by summing the dealer-level histories and dealer-level forecasts. This keeps the
hierarchy coherent.

## Festive Event Calendar

Festive adjustments are configured in the `forecast_event_calendar` table. Each
row defines:

- forecast type
- event code and name
- recurring start month and end month
- uplift percentage
- active flag

The seeded sample events are:

- New Year
- Ugaadi
- Dussehra
- Diwali

Because the forecasting grain is monthly, the event calendar is also monthly.
An event can cover a single month or a month window. Multiple events can apply
to the same month, and their uplift percentages are added together.

## Candidate Models

The forecast engine tests a small baseline model set for every dealer series.

### ARIMA Candidates

The implemented ARIMA baseline uses ARIMA(p,d,0), which means:

- `p`: autoregressive lag count.
- `d`: differencing order.
- `q`: moving-average order, fixed at `0` in this implementation.

The tested orders are:

- `ARIMA(0,0,0)`
- `ARIMA(1,0,0)`
- `ARIMA(2,0,0)`
- `ARIMA(0,1,0)`
- `ARIMA(1,1,0)`
- `ARIMA(2,1,0)`

For differenced models, the series is differenced before fitting and converted
back to sales units after forecasting. The autoregressive coefficients are fit
with least squares using normal equations.

### ETS Candidates

The ETS baseline tests exponential smoothing variants:

- `ETS(A,N,N)`: additive error style, no trend, no seasonality.
- `ETS(A,A,N)`: additive level and additive trend.
- `ETS(A,A,A)`: additive level, additive trend, additive monthly seasonality.

The seasonal ETS model only runs when there are at least two full 12-month
seasons available. Otherwise, it is skipped for that series.

## Model Selection

Each dealer series is split into a training segment and a holdout validation segment:

- The holdout window is up to the last 6 months.
- For shorter series, it uses roughly the last third of the data.
- If too little data exists, the system falls back to a 3-month moving average.

Each candidate model forecasts the holdout window. The system calculates:

- MAE: mean absolute error.
- RMSE: root mean squared error.
- MAPE: mean absolute percentage error, skipped for months where actual sales are `0`.

The model with the lowest MAE is selected. That winning model type is then refit
on the full dealer history and used to generate the final forecast horizon.

After dealer forecasts are created, the system rolls them up:

- State forecast = sum of dealer forecasts in that state.
- Zone forecast = sum of dealer forecasts in that zone.

Because those higher levels are aggregated from dealer results, total forecasted
units remain consistent across dealerwise, statewise, and zonewise views.

## Aftersales Forecast Domains

Aftersales forecasts use service-center hierarchy instead of dealer hierarchy:

- Service center: one series per service center.
- State: service-center forecasts summed by state.
- Zone: service-center forecasts summed by region or zone.

The worker creates one latest completed run per forecast domain in
`forecast_runs.forecast_domain`. The domain values are title-case:

- `Parts`
- `Service`
- `Warranty`
- `SLA`

Access is controlled through `user_access_scopes`. National scope can see all
service centers for the domain, Region scope can see only service centers in
that region, and Service Center scope can see only the assigned center. Service
Managers receive `View SLA Forecast` through the SLA migration and their
existing Service scopes are copied into the SLA domain.

### Parts Demand

Parts forecasting reads `monthly_service_parts_demand` and writes
`parts_forecast_data`.

The natural grain is:

- service center
- part id
- part category
- model id
- variant id
- month

Parts demand is often intermittent, so the preferred method is Croston's method
when a series has sparse non-zero demand. If the series is not intermittent, the
worker falls back to the shared moving-average and seasonal-index machinery.
The stored forecast unit is expected part demand.

### Service Order Volume

Service forecasting reads `monthly_service_order_volume` and writes
`service_forecast_data`.

The natural grain is:

- service center
- service type
- job category
- model id
- variant id
- month

The preferred method is a moving average with trend adjustment and monthly
seasonal factors when enough history is available. The stored forecast unit is
expected service orders.

### Warranty and Returns

Warranty forecasting reads `monthly_warranty_return_volume` and writes
`warranty_forecast_data`.

The natural grain is:

- service center
- claim type
- return reason
- age bucket
- model id
- variant id
- month

The point forecast is expected claims plus returns. The worker uses the same
moving-average, trend, seasonality, and empirical interval calibration flow as
Service.

### SLA Breach Risk

SLA forecasting reads `monthly_sla_performance` and writes
`sla_forecast_data`.

The source table is service-adjacent and is seeded from service order volume
history until richer SLA source data is available. The natural grain is:

- service center
- service type
- job category
- model id
- variant id
- month

The point forecast is expected SLA breaches. Each stored forecast point also
keeps risk-specific values:

- `expected_breaches`
- `breach_probability`
- `risk_score`
- `risk_level`

The first SLA scoring model is intentionally explainable. Expected breaches are
the primary driver, and wider 95% forecast intervals or weaker validation MAPE
raise the score. Risk levels are mapped from the score as Low, Medium, High, or
Critical.

## Aftersales Rollups

Parts, Service, and Warranty dashboard forecast queries can read from
`domain_forecast_rollups` instead of scanning detailed forecast rows. The worker
refreshes those rollups after saving a completed domain run. The rollup grains
are:

- Parts: total, part category, part.
- Service: total, service type, job category.
- Warranty: total, claim type, return reason, age bucket.

SLA currently reads directly from `sla_forecast_data` because the forecast rows
contain risk-specific fields that do not fit the shared unit-rollup table yet.

## Prediction Intervals

Each forecast point includes empirical prediction interval bands:

- `lower_80` and `upper_80`
- `lower_95` and `upper_95`

The interval method is conformal residual calibration over rolling hold-out
forecasts. For each dealer series, the worker replays up to the last 12 monthly
origins. At each origin, it trains the selected model family on the data
available at that time, forecasts the available future months, and records the
absolute residual by horizon month.

The 80% and 95% interval half-widths are empirical residual quantiles for each
horizon month. Because forecast uncertainty should not shrink simply due to
sparse samples at later horizons, the worker enforces non-decreasing
half-widths across the horizon. After the initial quantile calculation, the
worker adjusts the half-widths against the rolling hold-out residual samples
until observed 80% and 95% coverage are within +/-2 percentage points of their
nominal targets when possible. Sparse series fall back to a conservative
moving-average band.

Intervals are clipped at zero because vehicle unit demand cannot be negative.
Festive-event uplift rules are applied to the point forecast and interval
bounds together. State, zone, regional, and national interval bands are built
by aggregating the lower and upper bounds from dealer-level forecasts.

Run-level calibration metrics are stored with each completed forecast run and
returned by `/api/v1/forecasts/admin/status`:

- observed 80% and 95% coverage on rolling hold-out samples
- whether each coverage value is within the +/-2% tolerance of nominal
- calibration sample count
- average 80% and 95% interval width
- width by horizon month

If the final run-level 80% or 95% calibration coverage is outside the +/-2%
tolerance, the worker fails the forecast run instead of publishing intervals
that do not meet the calibration acceptance criterion.

## Event Uplifts

After the baseline dealer forecast is produced, the worker checks the forecast
month against `forecast_event_calendar`.

For a forecast month:

- if no event matches, the baseline forecast is unchanged
- if one or more events match, their `uplift_pct` values are summed
- the adjusted forecast becomes:

`adjusted units = round(baseline units * (1 + total uplift pct / 100))`

Example:

- baseline dealer forecast for November = 100 units
- Diwali uplift = 12.5%
- adjusted dealer forecast = `round(100 * 1.125)` = 113 units

The worker applies uplift to dealer forecasts first and then rebuilds state and
zone totals from those adjusted dealer values, so hierarchy totals stay aligned.

## Output Values

Forecasts are rounded to whole vehicle units and clipped at `0` so the stored
forecast never contains negative sales.

Each output series includes:

- Hierarchy level.
- Group id and label.
- Selected model method.
- Validation metrics from the holdout window.
- Forecast month.
- Forecast units.
- Prediction interval bounds: `lower_80`, `upper_80`, `lower_95`, and `upper_95`.

## Nightly Storage Flow

The forecast worker is a separate process:

```bash
npm run worker:forecast
```

It schedules itself for 12:00 AM local time. In Docker Compose, the worker uses
`TZ=Asia/Kolkata`, so the run happens at midnight India time.

The worker flow is:

1. Acquire a Postgres advisory lock so duplicate worker processes do not overlap.
2. Create a `forecast_runs` row with status `running`.
3. Build all overall, model, and variant scopes.
4. Load active festive-event uplift rules from `forecast_event_calendar`.
5. Generate dealerwise baseline forecasts for each scope.
6. Apply festive-event uplifts to dealer forecasts and rebuild state and zone totals.
7. Upsert current forecast points into `forecast_data`.
8. Remove any old forecast rows that are no longer produced by the latest run.
9. Mark the `forecast_runs` row as `completed`.
10. If an error occurs, mark the run as `failed` with the error message.

For aftersales domains the flow is similar:

1. Acquire the domain-specific advisory lock.
2. Create a `forecast_runs` row with the domain and forecast type.
3. Load active forecast events for the same domain and type.
4. Build service-center forecasts from the domain source table.
5. Apply event uplifts and rebuild state and zone totals.
6. Clear future rows that no longer map to source actual months.
7. Insert the new forecast rows in batches.
8. Refresh domain rollups for Parts, Service, and Warranty.
9. Store run-level calibration metrics and mark the run `completed`.

For immediate generation, use:

```bash
npm run forecast:run
```

Both worker scripts run migrations first, so the forecast tables are created
before generation.

## Forecast API

The stored forecast API is:

```bash
GET /api/v1/forecasts/baseline
```

Each forecast point in the response includes `unitsSold`, `lower_80`,
`upper_80`, `lower_95`, and `upper_95`.

Supported query parameters:

- `level`: `dealer`, `state`, or `zone`. Omit it to return all levels.
- `modelId`: optional model filter.
- `variantId` or `VariantId`: optional variant filter.

Examples:

```bash
curl "http://localhost:4000/api/v1/forecasts/baseline?level=dealer"
curl "http://localhost:4000/api/v1/forecasts/baseline?level=state&modelId=MDL001"
curl "http://localhost:4000/api/v1/forecasts/baseline?level=zone&variantId=VAR001"
```

The API only reads the latest completed forecast run. Failed or in-progress runs
are ignored.

Aftersales dashboard APIs use the domain in the path:

```bash
GET /api/v1/forecasts/parts
GET /api/v1/forecasts/service
GET /api/v1/forecasts/warranty
GET /api/v1/forecasts/sla
```

Each domain also supports:

- `/references`
- `/actuals`
- `/diagnostics`
- `/kpis`

Common query parameters are:

- `level`: `service_center`, `state`, or `zone`.
- `groupId`: optional service center, state, or zone id.
- `horizon`: forecast months to return.
- `startDate` and `endDate`: optional forecast date bounds.
- `serviceType` and `jobCategory`: Service and SLA filters.
- `partId` and `partCategory`: Parts filters.
- `claimType`, `returnReason`, and `ageBucket`: Warranty filters.
- `modelId` and `variantId`: optional vehicle filters.

Examples:

```bash
curl "http://localhost:4000/api/v1/forecasts/service?level=zone&horizon=6"
curl "http://localhost:4000/api/v1/forecasts/parts?level=service_center&groupId=SVC001&partCategory=Filters"
curl "http://localhost:4000/api/v1/forecasts/warranty/diagnostics?level=state&window=12"
curl "http://localhost:4000/api/v1/forecasts/sla?level=zone&serviceType=Repair"
```
