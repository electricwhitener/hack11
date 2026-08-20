"""
Analysis sidecar for the Next.js app.

Why a separate service: pandas/sklearn have no good JS equivalent, and keeping
them out of the web app means one teammate can work here without ever touching
the frontend. The web app talks to it through src/lib/ai/tools.ts.

Run:  uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import io
import uuid
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Analysis Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store. Fine for a 36-hour demo; swap for the Postgres DB if you
# need uploads to survive a restart.
DATASETS: dict[str, pd.DataFrame] = {}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/upload")
async def upload(file: UploadFile = File(...)) -> dict[str, Any]:
    """Accept a CSV and return a handle plus an immediate profile."""
    raw = await file.read()
    df = pd.read_csv(io.BytesIO(raw))
    dataset_id = str(uuid.uuid4())[:8]
    DATASETS[dataset_id] = df
    return {
        "dataset_id": dataset_id,
        "rows": len(df),
        "columns": list(df.columns),
        "dtypes": {c: str(t) for c, t in df.dtypes.items()},
        "preview": df.head(5).to_dict(orient="records"),
    }


class AnalyzeRequest(BaseModel):
    dataset_id: str
    question: str


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, Any]:
    """
    Returns facts about the dataset. Deliberately NOT an LLM call: the agent in
    the web app does the reasoning, this service supplies ground truth. Keeping
    the split clean is what stops the demo from hallucinating numbers.
    """
    df = DATASETS.get(req.dataset_id)
    if df is None:
        return {"error": f"Unknown dataset_id {req.dataset_id!r}. Upload a CSV first."}

    numeric = df.select_dtypes("number")

    result: dict[str, Any] = {
        "question": req.question,
        "rows": len(df),
        "columns": list(df.columns),
        "summary": numeric.describe().round(3).to_dict() if not numeric.empty else {},
        "missing": df.isna().sum().to_dict(),
    }

    if numeric.shape[1] >= 2:
        result["correlations"] = numeric.corr().round(3).to_dict()

    return result


class ForecastRequest(BaseModel):
    dataset_id: str
    column: str
    periods: int = 6


@app.post("/forecast")
def forecast(req: ForecastRequest) -> dict[str, Any]:
    """Straight-line trend projection. Swap for ARIMA/Prophet if the problem needs it."""
    import numpy as np

    df = DATASETS.get(req.dataset_id)
    if df is None:
        return {"error": "Unknown dataset_id"}
    if req.column not in df.columns:
        return {"error": f"No column {req.column!r}"}

    series = pd.to_numeric(df[req.column], errors="coerce").dropna()
    if len(series) < 3:
        return {"error": "Need at least 3 numeric points"}

    x = np.arange(len(series))
    slope, intercept = np.polyfit(x, series.values, 1)
    future_x = np.arange(len(series), len(series) + req.periods)
    predictions = (slope * future_x + intercept).round(3)

    return {
        "column": req.column,
        "history": [{"label": str(i), "value": float(v)} for i, v in enumerate(series.values)],
        "forecast": [
            {"label": f"t+{i + 1}", "value": float(v)} for i, v in enumerate(predictions)
        ],
        "trend": "rising" if slope > 0 else "falling" if slope < 0 else "flat",
    }
