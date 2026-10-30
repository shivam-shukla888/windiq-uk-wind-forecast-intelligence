from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .service import build_analysis, fetch_month_data, validate_month

app = FastAPI(title="WindIQ API", version="1.0.0", description="Elexon wind forecast vintage analysis for January 2026")
origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:4173").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET"], allow_headers=["*"])


async def _analysis(month: str, cutoff: str) -> dict[str, Any]:
    try:
        validate_month(month)
        forecasts, actuals = await fetch_month_data(month)
        return build_analysis(month, cutoff, forecasts, actuals)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Elexon data request failed: {exc}") from exc


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "windiq-api", "source": "Elexon BMRS Insights"}


@app.get("/api/analysis")
async def analysis(month: str = Query("2026-01", pattern=r"^\d{4}-\d{2}$"), cutoff: str = "day-ahead") -> dict[str, Any]:
    return await _analysis(month, cutoff)


@app.get("/api/forecasts")
async def forecasts(month: str = Query("2026-01", pattern=r"^\d{4}-\d{2}$"), cutoff: str = "day-ahead", limit: int = Query(200, ge=1, le=1488), offset: int = Query(0, ge=0)) -> dict[str, Any]:
    result = await _analysis(month, cutoff)
    records = result["records"]
    return {"month": month, "cutoff": cutoff, "total": len(records), "offset": offset, "limit": limit, "records": records[offset:offset + limit]}


@app.get("/api/quality")
async def quality(month: str = Query("2026-01", pattern=r"^\d{4}-\d{2}$"), cutoff: str = "day-ahead") -> dict[str, Any]:
    result = await _analysis(month, cutoff)
    return {"month": month, "cutoff": cutoff, "metrics": result["metrics"], "quality": result["quality"]}
