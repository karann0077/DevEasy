# main.py
import os
import time
import uuid
import zipfile
import tempfile
import shutil
import logging
import traceback
from typing import List, Optional
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pinecone import Pinecone

# -------------------------
# Basic configuration
# -------------------------
# Clear OS proxies (important on some hosting platforms)
for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
    os.environ.pop(key, None)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("innovate-bharat")

app = FastAPI(title="InnovateBHARAT Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your Vercel origin in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------
# Environment / Pinecone init
# -------------------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_ENV = os.getenv("PINECONE_ENV")  # e.g. "us-east1-gcp"
PINECONE_INDEX = os.getenv("PINECONE_INDEX")

if not GEMINI_API_KEY:
    logger.warning("GEMINI_API_KEY is not set")
if not PINECONE_API_KEY:
    logger.warning("PINECONE_API_KEY is not set")
if not PINECONE_INDEX:
    logger.warning("PINECONE_INDEX is not set")

# Initialize Pinecone client (v3 style)
_pc = None
_index = None
try:
    _pc = Pinecone(api_key=PINECONE_API_KEY, environment=PINECONE_ENV)
    if PINECONE_INDEX:
        _index = _pc.Index(PINECONE_INDEX)
    logger.info("Pinecone client initialized. Index: %s", PINECONE_INDEX)
except Exception as e:
    logger.exception("Pinecone initialization failed: %s", e)

# -------------------------
# Simple chunking utility
# -------------------------
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP):
    chunks = []
    if not text:
        return chunks
    start = 0
    n = len(text)
    while start < n:
        end = min(start + chunk_size, n)
        chunks.append(text[start:end])
        start = end - overlap
        if start < 0:
            start = 0
    return chunks

# -------------------------
# Robust Gemini embedding
# -------------------------
def _find_vector(obj):
    """Recursively find first plausible numeric vector in JSON."""
    if isinstance(obj, list):
        if len(obj) >= 2 and all(isinstance(x, (int, float)) for x in obj):
            return obj
        for item in obj:
            v = _find_vector(item)
            if v:
                return v
    elif isinstance(obj, dict):
        for k, v in obj.items():
            v2 = _find_vector(v)
            if v2:
                return v2
    return None

def gemini_embed(text: str, output_dim: int = 768, debug: bool = False) -> List[float]:
    """
    Tries multiple base paths and model names to get an embedding from Generative Language API.
    Returns a list of floats of exactly `output_dim` length (sliced or zero-padded).
    Raises Exception with a structured details dict on failure.
    """
    if not GEMINI_API_KEY:
        raise Exception("GEMINI_API_KEY not configured in environment")

    bases = ["v1", "v1beta"]
    models = [
        "gemini-embedding-001",
        "text-embedding-004",
        "embedding-001",
        "textembedding-3-large"  # keep as fallback (rare)
    ]

    attempts = []
    for base in bases:
        for model in models:
            # Do NOT log the key. Log only base+model.
            url = f"https://generativelanguage.googleapis.com/{base}/models/{model}:embedContent?key=REDACTED"
            payload = {
                "model": f"models/{model}" if base.endswith("beta") else model,
                "content": {"parts": [{"text": text}]},
                "outputDimensionality": output_dim
            }
            # Some endpoints don't want "model" field in body; try without if it fails later.
            try:
                # Construct actual URL with real key but do not log it
                real_url = f"https://generativelanguage.googleapis.com/{base}/models/{model}:embedContent?key={GEMINI_API_KEY}"
                r = requests.post(real_url, json=payload, timeout=30)
            except Exception as e:
                attempts.append({"base": base, "model": model, "error": f"network:{str(e)}"})
                if debug:
                    logger.exception("Network error calling Gemini base=%s model=%s", base, model)
                continue

            status = r.status_code
            # try to parse body safely
            text_body = r.text
            try:
                js = r.json()
            except Exception:
                js = None

            logger.info("Gemini call base=%s model=%s status=%s", base, model, status)
            if debug:
                logger.debug("Gemini response (truncated): %s", text_body[:2000])

            if status == 200:
                # find first numeric vector field
                vec = _find_vector(js)
                if vec is None:
                    attempts.append({"base": base, "model": model, "status": status, "body": js})
                    continue

                # Normalize to output_dim
                if len(vec) > output_dim:
                    vec = vec[:output_dim]
                elif len(vec) < output_dim:
                    vec = vec + [0.0] * (output_dim - len(vec))

                return vec
            else:
                # store the response for debugging (avoid logging keys)
                attempts.append({"base": base, "model": model, "status": status, "body": js or text_body})
            time.sleep(0.08)  # small throttle between tries

    # Nothing worked
    logger.error("All Gemini embed attempts failed. Attempts: %s", attempts)
    raise Exception({"message": "All Gemini embed attempts failed", "attempts": attempts})

# -------------------------
# API models
# -------------------------
class IngestRequest(BaseModel):
    repo_url: str

class ExplainRequest(BaseModel):
    query: str

# -------------------------
# Health endpoint
# -------------------------
@app.get("/api/health")
def health():
    missing = [k for k in ("GEMINI_API_KEY", "PINECONE_API_KEY", "PINECONE_INDEX") if not os.getenv(k)]
    pine_info = {"ok": False, "indexes": None, "error": None}
    try:
        if PINECONE_API_KEY:
            pc_temp = Pinecone(api_key=PINECONE_API_KEY, environment=PINECONE_ENV)
            pine_info["indexes"] = pc_temp.list_indexes()
            pine_info["ok"] = True
    except Exception as e:
        pine_info["error"] = str(e)
    return {
        "ok": len(missing) == 0,
        "missing_env": missing,
        "pinecone": pine_info,
        "note": "If ok==false, check missing env vars and Render config."
    }

# -------------------------
# Ingest endpoint
# -------------------------
@app.post("/api/ingest")
def ingest(req: IngestRequest):
    logs = []
    try:
        repo_url = req.repo_url
        logger.info("Starting ingestion for %s", repo_url)
        parsed = urlparse(repo_url)
        parts = parsed.path.strip("/").split("/")
        if len(parts) < 2:
            raise HTTPException(status_code=400, detail="Invalid GitHub repo URL")
        owner, repo = parts[0], parts[1].replace(".git", "")

        # download zipball
        zip_url = f"https://api.github.com/repos/{owner}/{repo}/zipball"
        logger.info("Downloading from %s", zip_url)
        r = requests.get(zip_url, timeout=60)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"GitHub download failed: {r.status_code}")

        tmpdir = tempfile.mkdtemp()
        zip_path = os.path.join(tmpdir, "repo.zip")
        with open(zip_path, "wb") as f:
            f.write(r.content)

        extract_dir = os.path.join(tmpdir, "extracted")
        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(extract_dir)

        # walk files and chunk + embed
        allowed_ext = {".py", ".js", ".ts", ".jsx", ".tsx", ".cpp", ".c", ".h", ".md"}
        vectors_batch = []
        total_chunks = 0
        BATCH_SIZE = 50
        EMBED_DELAY = 0.25

        for root, _, files in os.walk(extract_dir):
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in allowed_ext:
                    continue
                full = os.path.join(root, fname)
                try:
                    with open(full, "r", encoding="utf-8", errors="ignore") as fh:
                        txt = fh.read()
                except Exception:
                    logger.exception("Failed to read file %s", full)
                    continue

                chunks = chunk_text(txt)
                for chunk in chunks:
                    try:
                        vec = gemini_embed(chunk, output_dim=768, debug=False)
                    except Exception as e:
                        # log but continue with other chunks
                        logger.warning("Embedding error for file %s: %s", fname, str(e))
                        continue

                    item = {
                        "id": str(uuid.uuid4()),
                        "values": vec,
                        "metadata": {"repo": repo, "path": full.replace(extract_dir + "/", ""), "text": (chunk[:1000] + "...") if len(chunk) > 1000 else chunk}
                    }
                    vectors_batch.append(item)
                    total_chunks += 1

                    if len(vectors_batch) >= BATCH_SIZE:
                        if _index:
                            _index.upsert(vectors_batch)
                            logger.info("Upserted batch of %s vectors", len(vectors_batch))
                        else:
                            logger.warning("No Pinecone index configured; skipping upsert")
                        vectors_batch = []
                    time.sleep(EMBED_DELAY)

        if vectors_batch:
            if _index:
                _index.upsert(vectors_batch)
                logger.info("Upserted final batch of %s vectors", len(vectors_batch))
            else:
                logger.warning("No Pinecone index configured; final batch skipped")

        shutil.rmtree(tmpdir)
        logger.info("Ingestion complete. Chunks stored: %s", total_chunks)
        return {"status": "success", "chunks_indexed": total_chunks, "logs": logs}

    except Exception as e:
        tb = traceback.format_exc()
        logger.error("Ingest failed: %s", tb)
        return {"status": "error", "error": str(e), "traceback": tb, "logs": logs}

# -------------------------
# Explain endpoint (RAG)
# -------------------------
@app.post("/api/explain")
def explain(req: ExplainRequest):
    try:
        if not _index:
            raise Exception("Pinecone index not configured")

        query = req.query
        qvec = gemini_embed(query, output_dim=768)
        # query pinecone
        res = _index.query(vector=qvec, top_k=5, include_metadata=True)
        # collect contexts
        contexts = []
        matches = res.get("matches") or res.get("matches", [])  # compatibility
        for m in matches:
            md = m.get("metadata") or {}
            text = md.get("text") or md.get("content") or ""
            path = md.get("path")
            contexts.append(f"FILE: {path}\n{text}")

        prompt = f"""You are an expert codebase architect. Use the following retrieved file chunks to answer the user's question.\n\nRetrieved context:\n\n{'\n\n'.join(contexts)}\n\nUser question:\n{query}\n\nProvide a Markdown formatted answer including Architectural Warnings and Suggested Tests."""
        # call gemini generate endpoint (simple REST call)
        gen_url = f"https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY}"
        body = {"contents":[{"parts":[{"text": prompt}]}]}
        r = requests.post(gen_url, json=body, timeout=60)
        if r.status_code != 200:
            raise Exception(f"Gemini generate failed: {r.status_code} - {r.text}")

        j = r.json()
        # locate candidate text
        cand = None
        try:
            cand = j["candidates"][0]["content"]["parts"][0]["text"]
        except Exception:
            # fallback: try to find any text string in response
            cand = str(j)
        return {"answer": cand, "raw_response": j}

    except Exception as e:
        tb = traceback.format_exc()
        logger.error("Explain failed: %s", tb)
        return {"status": "error", "error": str(e), "traceback": tb}
