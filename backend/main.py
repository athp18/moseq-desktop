import argparse
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.project import router as project_router
from api.pipeline import router as pipeline_router
from api.roi import router as roi_router
from api.sessions import router as sessions_router
from api.pca import router as pca_router
from api.model import router as model_router
from api.analyze import router as analyze_router

app = FastAPI(title="MoSeq Desktop Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(project_router, prefix="/project")
app.include_router(pipeline_router, prefix="/pipeline")
app.include_router(roi_router, prefix="/roi")
app.include_router(sessions_router, prefix="/sessions")
app.include_router(pca_router, prefix="/pca")
app.include_router(model_router, prefix="/model")
app.include_router(analyze_router, prefix="/analyze")


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
