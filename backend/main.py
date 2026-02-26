import os
import traceback
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

class IngestRequest(BaseModel):
    repo_url: str

class IngestResponse(BaseModel):
    status: str
    logs: list
    chunks_ingested: int = 0

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/api/ingest", response_model=IngestResponse)
def ingest_repo(req: IngestRequest):
    logs = ["[START] Ingestion called."]
    try:
        logs.append(f"[1/6] Parsing GitHub URL: {req.repo_url}")

        # --- PLACEHOLDER LOGIC: You can try real logic, but for now, demo always returns error! ---
        # Simulate an error if your keys are missing:
        if not os.getenv("GEMINI_API_KEY") or not os.getenv("PINECONE_API_KEY"):
            raise Exception("API KEY(S) MISSING: Set GEMINI_API_KEY and PINECONE_API_KEY in backend environment variables.")

        # Simulate a successful run for demo only:
        logs.append("[SUCCESS] Repo ingestion would succeed here (demo mode).")
        return IngestResponse(status="success", logs=logs, chunks_ingested=123)

    except Exception as e:
        logs.append(f"❌ ERROR: {str(e)}")
        logs.append(traceback.format_exc())
        # Ensure logs always returned in HTTPException
        raise HTTPException(status_code=500, detail={"logs": logs, "error": str(e)})
