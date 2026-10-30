# WindIQ

WindIQ compares UK wind generation forecasts from Elexon with the generation later recorded as actual. It is a small January 2026 pilot for a day-ahead trading team: choose a forecast cutoff, review the forecast available by then, and see how it performed.

## What is included

- A forecast and actual explorer with publication times and interval errors.
- MAE, RMSE, MAPE, signed bias and data coverage.
- An error heatmap and a data-quality view.
- CSV export and a FastAPI API.

The backend requests only Elexon FUELHH and WINDFOR. It uses FUELHH rows with `fuelType=WIND`, keeps the latest actual revision for each `startTime`, and joins forecasts to actuals on UTC `startTime`. For each delivery interval it selects the eligible WINDFOR row with the latest `publishTime`.

The default cutoff is 24 hours before delivery. You can also set one UTC cutoff for the whole month. MAPE excludes intervals where actual generation is zero; the API reports how many were excluded. Bias is forecast minus actual, so a positive bias means the forecast ran high.

## January 2026 data

I queried the Elexon API while building the app. It returned 1,488 half-hourly wind actuals from FUELHH and, at the default cutoff, 744 hourly WINDFOR forecasts that matched an actual timestamp. That is 50% coverage of the 1,488 expected intervals. The app reports accuracy on the matched intervals and leaves the other intervals uncovered; it does not fill them by interpolation.

Elexon’s Insights API is public and includes historical data. See the [developer portal](https://developer.data.elexon.co.uk/), [Insights platform notes](https://github.com/elexon-data/insights-docs/blob/main/docs/insights_data_platform.md), and [WINDFOR history endpoint](https://bmrs.elexon.co.uk/api-documentation/endpoint/forecast/generation/wind/history). The API limits WINDFOR publication-time queries to seven days, so the backend fetches smaller windows and removes duplicate boundary rows.

## Run locally

With Docker Desktop:

```bash
docker compose up --build
```

Open http://localhost:5173. FastAPI runs at http://localhost:8000, with its schema at http://localhost:8000/docs.

To run the services separately, use Python 3.11+ and Node.js 20+:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

For a separately hosted API, set `VITE_API_URL` to its origin. Set the backend’s `CORS_ORIGINS` to the frontend origin.

## API routes

- `GET /api/health`
- `GET /api/analysis?month=2026-01&cutoff=day-ahead`
- `GET /api/forecasts?month=2026-01&cutoff=day-ahead&limit=200`
- `GET /api/quality?month=2026-01&cutoff=day-ahead`

The pilot accepts January 2026 only. A custom cutoff is an ISO-8601 timestamp; all API timestamps are returned in UTC.

## Checks

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

The tests cover vintage selection, timezone normalization, timestamp joins, and metric calculations. The frontend build is `npm run build` from `frontend`.

## Deployment configuration

The frontend can be deployed from the `frontend` directory on Vercel (`npm run build`, output `dist`). Set `VITE_API_URL` to the API’s public origin. The root `render.yaml` describes a Docker deployment for the FastAPI service; set `CORS_ORIGINS` there to the Vercel URL. The app has not been deployed yet.

## AI assistance

I used Codex to help write and review the application, tests and documentation. The wind records and reported metrics come from Elexon’s API; AI did not generate or alter the data.

## Scope

This app reviews wind forecasts; it does not recommend trades. The assignment’s data scope excludes demand, prices and other generation sources, so the app cannot calculate a utility’s full power shortfall or procurement position.
