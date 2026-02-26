import os
import time
import json
import uuid
import zipfile
import shutil
import tempfile
import traceback
from typing import List
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# IMPORTANT: Clear system proxies to avoid Render / environment network issues
os.environ.pop('http_proxy', None)
os.environ.pop('https_proxy', None)
os.environ.pop('HTTP_PROXY', None)
os.environ.pop('HTTPS_PROXY', None)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------- Pydantic models --------------------
class IngestRequest(BaseModel):
    repo_url: str

class IngestResponse(BaseModel):
    status: str
    logs: List[str]
    chunks_ingested: int

# -------------------- Config from env --------------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Support alternate names (some UIs use PINECONE_INDEX_NAME / PINECONE_REGION)
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_ENV = os.getenv("PINECONE_ENV") or os.getenv("PINECONE_REGION")
PINECONE_INDEX = os.getenv("PINECONE_INDEX") or os.getenv("PINECONE_INDEX_NAME")

# Basic validation (warnings only; final errors returned in responses)
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY is not set in environment")
if not PINECONE_API_KEY or not PINECONE_ENV or not PINECONE_INDEX:
    print("WARNING: Pinecone environment variables are not fully set (PINECONE_API_KEY, PINECONE_ENV, PINECONE_INDEX)")

# -------------------- Utility helpers --------------------
ALLOWED_EXT = {".py", ".js", ".ts", ".jsx", ".tsx", ".cpp", ".c", ".h", ".md", ".json", ".yaml", ".yml", ".html", ".css"}
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
EMBED_DELAY = 0.25  # seconds between embedding requests (as requested)
UPSERT_BATCH = 100

def parse_github_repo(url: str):
    """Extract owner and repo from common GitHub repo URLs.
    Returns (owner, repo) or None.
    """
    try:
        parsed = urlparse(url)
        if parsed.netloc not in ("github.com", "www.github.com"):
            return None
        parts = parsed.path.strip("/").split("/")
        if len(parts) < 2:
            return None
        owner, repo = parts[0], parts[1]
        if repo.endswith('.git'):
            repo = repo[:-4]
        return owner, repo
    except Exception:
        return None

def simple_chunk_text(text: str, chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP):
    """Chunk text into pieces of at most chunk_size with overlap."""
    if not text:
        return []
    out = []
    start = 0
    length = len(text)
    while start < length:
        end = min(start + chunk_size, length)
        out.append(text[start:end])
        if end == length:
            break
        start = max(end - chunk_overlap, 0)
    return out

def make_gemini_embedding(text: str):
    """Call Gemini embedding REST endpoint. Returns a list[float]."""
    if text is None or text.strip() == "":
        return None

    url = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent"

    headers = {"Content-Type": "application/json"}
    params = None
    if GEMINI_API_KEY:
        # heuristic: attach key either as ?key= or as Bearer token
        if GEMINI_API_KEY.startswith("AIza"):
            params = {"key": GEMINI_API_KEY}
        else:
            headers["Authorization"] = f"Bearer {GEMINI_API_KEY}"

    body = {
        "content": text,
        "mimeType": "text/plain",
        "embeddingParams": {"outputDimensionality": 768}
    }

    resp = requests.post(url, headers=headers, params=params, json=body, timeout=60)
    if resp.status_code != 200:
        raise Exception(f"Gemini embedding failed: {resp.status_code} {resp.text}")

    data = resp.json()
    if isinstance(data, dict) and "embedding" in data and isinstance(data["embedding"], list):
        vec = data["embedding"]
    elif "embeddings" in data and isinstance(data["embeddings"], list) and len(data["embeddings"])>0:
        vec = data["embeddings"][0].get("embedding")
    else:
        raise Exception(f"Unexpected Gemini embedding response shape: {json.dumps(data)[:400]}")

    if not isinstance(vec, list):
        raise Exception("Embedding vector not a list")

    vec = [float(x) for x in vec]
    if len(vec) < 768:
        raise Exception(f"Received embedding length {len(vec)} < 768")
    return vec[:768]

# -------------------- Pinecone helper (best-effort) --------------------
try:
    import pinecone
    PINECONE_AVAILABLE = True
except Exception:
    pinecone = None
    PINECONE_AVAILABLE = False

def upsert_to_pinecone(index_name: str, vectors: List[dict], logs: List[str]):
    """Upsert a batch of vectors to Pinecone. vectors = [{id, values, metadata}, ...]"""
    if not PINECONE_AVAILABLE:
        raise Exception("pinecone client library is not available in the environment")

    if not PINECONE_API_KEY or not PINECONE_ENV:
        raise Exception("Pinecone API env vars missing (PINECONE_API_KEY / PINECONE_ENV)")

    try:
        client = pinecone.Client(api_key=PINECONE_API_KEY, environment=PINECONE_ENV)
        index = client.Index(index_name)
    except Exception as e:
        raise Exception(f"Failed to initialize Pinecone client: {e}")

    try:
        index.upsert(vectors=vectors)
    except TypeError:
        tup = [(v['id'], v['values'], v.get('metadata')) for v in vectors]
        index.upsert(tup)
    except Exception as e:
        raise

# -------------------- Endpoint --------------------
@app.post("/api/ingest", response_model=IngestResponse)
def ingest_repo(req: IngestRequest):
    logs = []
    chunks_count = 0
    try:
        logs.append(f"🔎 Starting ingestion for {req.repo_url}")

        parsed = parse_github_repo(req.repo_url)
        if not parsed:
            raise Exception("Could not parse GitHub repo URL. Use a URL like https://github.com/owner/repo")
        owner, repo = parsed
        zip_url = f"https://api.github.com/repos/{owner}/{repo}/zipball"
        logs.append(f"📦 Downloading zipball from: {zip_url}")

        # Download zipball
        with requests.get(zip_url, stream=True, timeout=60) as r:
            if r.status_code != 200:
                raise Exception(f"GitHub download failed: {r.status_code} {r.text}")
            tmpdir = tempfile.mkdtemp(prefix="ingest_")
            zpath = os.path.join(tmpdir, "repo.zip")
            with open(zpath, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
        logs.append(f"✅ Downloaded zip to {zpath}")

        extract_dir = os.path.join(tmpdir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zpath, 'r') as z:
            z.extractall(extract_dir)
        logs.append(f"✅ Extracted zip to {extract_dir}")

        # Walk files and collect valid code files
        file_entries = []
        for root, _, files in os.walk(extract_dir):
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext in ALLOWED_EXT:
                    abs_path = os.path.join(root, fname)
                    rel_path = os.path.relpath(abs_path, extract_dir)
                    file_entries.append((abs_path, rel_path))
        logs.append(f"Found {len(file_entries)} files matching allowed extensions")

        if not file_entries:
            raise Exception("No source files found in repo matching allowed extensions")

        upsert_buffer = []

        for abs_path, rel_path in file_entries:
            try:
                with open(abs_path, 'r', encoding='utf-8') as f:
                    text = f.read()
            except UnicodeDecodeError:
                try:
                    with open(abs_path, 'r', encoding='latin-1') as f:
                        text = f.read()
                except Exception:
                    logs.append(f"⚠️ Skipping binary/unreadable file: {rel_path}")
                    continue
            except Exception as e:
                logs.append(f"⚠️ Error reading {rel_path}: {e}")
                continue

            chunks = simple_chunk_text(text)
            for i, chunk in enumerate(chunks):
                chunk_id = str(uuid.uuid4())
                metadata = {
                    "repo": repo,
                    "repo_url": req.repo_url,
                    "path": rel_path,
                    "chunk_index": i,
                }

                try:
                    vec = make_gemini_embedding(chunk)
                except Exception as e:
                    raise Exception(f"Embedding failed for {rel_path}@{i}: {e}")

                if len(vec) != 768:
                    vec = vec[:768] + [0.0] * max(0, 768 - len(vec))

                upsert_buffer.append({
                    "id": chunk_id,
                    "values": vec,
                    "metadata": metadata,
                })
                chunks_count += 1

                if len(upsert_buffer) >= UPSERT_BATCH:
                    logs.append(f"⤴️ Upserting batch of {len(upsert_buffer)} vectors to Pinecone")
                    upsert_to_pinecone(PINECONE_INDEX, upsert_buffer, logs)
                    upsert_buffer = []

                time.sleep(EMBED_DELAY)

        if upsert_buffer:
            logs.append(f"⤴️ Upserting final batch of {len(upsert_buffer)} vectors to Pinecone")
            upsert_to_pinecone(PINECONE_INDEX, upsert_buffer, logs)

        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass

        logs.append(f"🎉 Ingestion complete. Chunks ingested: {chunks_count}")
        return IngestResponse(status="success", logs=logs, chunks_ingested=chunks_count)

    except Exception as e:
        logs.append(f"❌ ERROR: {str(e)}")
        logs.append(traceback.format_exc())
        raise HTTPException(status_code=500, detail={"logs": logs, "error": str(e)})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=False)
