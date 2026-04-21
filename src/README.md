# ReactJS + Node.js + PostgreSQL Monorepo

This repository is a simple npm workspaces monorepo with:

- `apps/web`: ReactJS frontend powered by Vite
- `apps/api`: Node.js Express backend connected to PostgreSQL

## Prerequisites

- Node.js 20+
- npm 10+
- Docker Desktop (recommended for PostgreSQL)

## Project structure

```text
.
|-- apps
|   |-- api
|   `-- web
|-- docker-compose.yml
`-- package.json
```

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

Copy the backend environment example:

```bash
copy apps\api\.env.example apps\api\.env
```

## 3. Run with Docker

Start the backend API and PostgreSQL together:

```bash
docker compose up -d
```

This starts PostgreSQL on `localhost:5432` and the backend API on `localhost:4000`.

To rebuild the API image after backend changes:

```bash
docker compose up -d --build api
```

To view backend logs:

```bash
docker compose logs -f api
```

## 4. Run the apps

Run frontend and backend together:

```bash
npm run dev
```

Or separately:

```bash
npm run dev:web
npm run dev:api
```

## URLs

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`
- Backend health check: `http://localhost:4000/api/health`

## API endpoints

- `GET /api/health`
- `GET /api/db-check`
- `GET /api/forecasts/baseline`

### Baseline forecast API

The forecast worker stores baseline ARIMA/ETS forecasts in `forecast_runs` and
`forecast_data`. The API returns the latest completed stored forecast run.
See `docs/forecasting-methodology.md` for the calculation details.

Query parameters:

- `level`: `dealer`, `state`, or `zone` (omit for all levels)
- `modelId`: optional model filter, for example `MDL001`
- `variantId`: optional variant filter, for example `VAR001`

Examples:

```bash
curl "http://localhost:4000/api/forecasts/baseline?level=dealer"
curl "http://localhost:4000/api/forecasts/baseline?level=state&modelId=MDL001"
curl "http://localhost:4000/api/forecasts/baseline?level=zone&variantId=VAR001"
```

### Forecast worker

Run migrations to create forecast tables:

```bash
npm run migrate:api
```

Generate and store forecasts immediately:

```bash
npm run forecast:run
```

Run the separate worker process that schedules generation every night at 12:00 AM:

```bash
npm run worker:forecast
```

Docker Compose also includes a `forecast-worker` service. It runs migrations on
startup, stays alive as a separate process, and generates the latest stored
baseline forecast every night at 12:00 AM India time.

## Notes

- The frontend reads `VITE_API_URL` from `apps/web/.env` if you want to override the backend base URL.
- The backend uses a PostgreSQL connection pool through the `pg` package.
- When running the API in Docker, `DATABASE_URL` uses the Compose service hostname `postgres`.
- When running the API locally, `DATABASE_URL` should use `localhost`.
