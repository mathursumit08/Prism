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

## Notes

- The frontend reads `VITE_API_URL` from `apps/web/.env` if you want to override the backend base URL.
- The backend uses a PostgreSQL connection pool through the `pg` package.
- When running the API in Docker, `DATABASE_URL` uses the Compose service hostname `postgres`.
- When running the API locally, `DATABASE_URL` should use `localhost`.
