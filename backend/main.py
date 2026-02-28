import os
import time
import json
import uuid
import zipfile
import shutil
import tempfile
import traceback
from typing import List, Dict, Any
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain.text_splitter import RecursiveCharacterTextSplitter

# IMPORTANT: Clear system proxies
os.environ.pop('http_proxy', None)
os.environ.pop('https_proxy', None)
os.environ.pop('HTTP_PROXY', None)
os.environ.pop('HTTPS_PROXY', None)

app = FastAPI(title="InnovateBHARAT AI Engine", version="1.0.0")

# CORS Configuration
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
ALLOWED_ORIGINS = ["*"] if ENVIRONMENT != "production" else [
    "https://innovate-bharat.vercel.app",
    "https://www.innovate-bharat.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Models
class IngestRequest(BaseModel):
    repo_url: str

class IngestResponse(BaseModel):
    status: str
    logs: List[str]
    chunks_ingested: int

class ExplainRequest(BaseModel):
    query: str

class ExplainResponse(BaseModel):
    answer: str

class DebugRequest(BaseModel):
    commit_url: str

class DebugResponse(BaseModel):
    blast_radius: List[str]
    pr_summary: str
    diff: str

class ArchitectureRequest(BaseModel):
    repo_url: str = None

class ArchitectureResponse(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]

# Environment Variables
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_ENV = os.getenv("PINECONE_ENV") or os.getenv("PINECONE_REGION")
PINECONE_INDEX = os.getenv("PINECONE_INDEX") or os.getenv("PINECONE_INDEX_NAME")
PORT = int(os.getenv("PORT", 8000))

# Configuration Validation
if not GEMINI_API_KEY:
    print("⚠️ WARNING: GEMINI_API_KEY not set")
if not PINECONE_API_KEY or not PINECONE_ENV or not PINECONE_INDEX:
    print("⚠️ WARNING: Pinecone variables incomplete")

# Constants
ALLOWED_EXT = {".py", ".js", ".ts", ".jsx", ".tsx", ".cpp", ".c", ".h", ".md", ".json", ".yaml", ".yml", ".html", ".css"}
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
EMBED_DELAY = 0.25
UPSERT_BATCH = 100

# Text Splitter
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    separators=["\n\n", "\n", " ", ""]
)

# Helper Functions
def parse_github_repo(url: str):
    """Extract owner and repo from GitHub URL."""
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

def make_gemini_embedding(text: str):
    """Generate embedding using Gemini API."""
    if text is None or text.strip() == "":
        return None

    url = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent"
    headers = {"Content-Type": "application/json"}
    params = {}
    
    if GEMINI_API_KEY:
        if GEMINI_API_KEY.startswith("AIza"):
            params = {"key": GEMINI_API_KEY}
        else:
            headers["Authorization"] = f"Bearer {GEMINI_API_KEY}"

    body = {
        "content": {"parts": [{"text": text}]},
        "outputDimensionality": 768
    }

    try:
        resp = requests.post(url, headers=headers, params=params, json=body, timeout=60)
        if resp.status_code != 200:
            raise Exception(f"Gemini failed: {resp.status_code}")

        data = resp.json()
        vec = data.get("embedding", {}).get("values", [])
        
        if not vec:
            raise Exception("No embedding in response")

        vec = [float(x) for x in vec]
        
        # Ensure 768 dimensions
        if len(vec) > 768:
            vec = vec[:768]
        elif len(vec) < 768:
            vec = vec + [0.0] * (768 - len(vec))
        
        return vec
    except Exception as e:
        raise Exception(f"Embedding error: {str(e)}")

# Pinecone Functions
try:
    from pinecone import Pinecone
    PINECONE_AVAILABLE = True
except Exception:
    try:
        import pinecone
        PINECONE_AVAILABLE = True
    except Exception:
        PINECONE_AVAILABLE = False

def upsert_to_pinecone(index_name: str, vectors: List[dict]):
    """Upsert vectors to Pinecone."""
    if not PINECONE_AVAILABLE:
        raise Exception("pinecone not available")
    if not PINECONE_API_KEY or not PINECONE_ENV or not PINECONE_INDEX:
        raise Exception("Pinecone credentials missing")

    try:
        try:
            from pinecone import Pinecone
            pc = Pinecone(api_key=PINECONE_API_KEY)
            index = pc.Index(index_name, host=PINECONE_ENV)
            index.upsert(vectors=vectors)
        except Exception:
            import pinecone
            pinecone.init(api_key=PINECONE_API_KEY, environment=PINECONE_ENV)
            index = pinecone.Index(index_name)
            index.upsert(vectors=vectors)
    except Exception as e:
        raise Exception(f"Pinecone error: {str(e)}")

def query_pinecone(query_embedding: list, top_k: int = 5) -> List[dict]:
    """Query Pinecone for similar chunks."""
    if not PINECONE_AVAILABLE or not all([PINECONE_API_KEY, PINECONE_ENV, PINECONE_INDEX]):
        return []

    try:
        try:
            from pinecone import Pinecone
            pc = Pinecone(api_key=PINECONE_API_KEY)
            index = pc.Index(PINECONE_INDEX, host=PINECONE_ENV)
            results = index.query(vector=query_embedding, top_k=top_k, include_metadata=True)
        except Exception:
            import pinecone
            pinecone.init(api_key=PINECONE_API_KEY, environment=PINECONE_ENV)
            index = pinecone.Index(PINECONE_INDEX)
            results = index.query(query_embedding, top_k=top_k, include_metadata=True)
        
        return results.get("matches", []) if hasattr(results, "get") else results
    except Exception as e:
        print(f"Query error: {e}")
        return []

# Endpoints
@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "environment": ENVIRONMENT,
        "pinecone_available": PINECONE_AVAILABLE,
        "gemini_key_set": bool(GEMINI_API_KEY)
    }

@app.get("/")
def root():
    """Root endpoint."""
    return {
        "service": "InnovateBHARAT AI Engine",
        "version": "1.0.0",
        "status": "running"
    }

@app.post("/api/ingest", response_model=IngestResponse)
def ingest_repo(req: IngestRequest):
    """Ingest a GitHub repository."""
    logs = []
    chunks_count = 0
    
    try:
        logs.append(f"🔎 Starting ingestion for {req.repo_url}")

        parsed = parse_github_repo(req.repo_url)
        if not parsed:
            raise Exception("Invalid GitHub URL")
        
        owner, repo = parsed
        zip_url = f"https://api.github.com/repos/{owner}/{repo}/zipball"
        logs.append(f"📦 Downloading from {zip_url}")

        # Download repo
        downloaded_size = 0
        with requests.get(zip_url, stream=True, timeout=60) as r:
            if r.status_code != 200:
                raise Exception(f"Download failed: {r.status_code}")
            
            tmpdir = tempfile.mkdtemp(prefix="ingest_")
            zpath = os.path.join(tmpdir, "repo.zip")
            
            with open(zpath, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded_size += len(chunk)

        logs.append(f"✅ Downloaded {downloaded_size / (1024*1024):.1f} MB")

        # Extract
        extract_dir = os.path.join(tmpdir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zpath, 'r') as z:
            z.extractall(extract_dir)
        logs.append(f"✅ Extracted")

        # Find files
        file_entries = []
        for root, _, files in os.walk(extract_dir):
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext in ALLOWED_EXT:
                    abs_path = os.path.join(root, fname)
                    rel_path = os.path.relpath(abs_path, extract_dir)
                    file_entries.append((abs_path, rel_path))

        logs.append(f"📄 Found {len(file_entries)} files")

        if not file_entries:
            raise Exception("No files found")

        # Process files
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
                    logs.append(f"⚠️ Skipping: {rel_path}")
                    continue
            except Exception as e:
                logs.append(f"⚠️ Error: {rel_path}")
                continue

            # Chunk and embed
            chunks = text_splitter.split_text(text)
            
            for i, chunk in enumerate(chunks):
                if not chunk.strip():
                    continue
                
                try:
                    vec = make_gemini_embedding(chunk)
                    if not vec:
                        continue
                    
                    upsert_buffer.append({
                        "id": str(uuid.uuid4()),
                        "values": vec,
                        "metadata": {
                            "repo": repo,
                            "repo_url": req.repo_url,
                            "path": rel_path,
                            "chunk_index": i,
                        }
                    })
                    chunks_count += 1

                    if len(upsert_buffer) >= UPSERT_BATCH:
                        upsert_to_pinecone(PINECONE_INDEX, upsert_buffer)
                        logs.append(f"⤴️ Upserted {len(upsert_buffer)}")
                        upsert_buffer = []

                    time.sleep(EMBED_DELAY)

                except Exception as e:
                    logs.append(f"⚠️ Embedding error: {str(e)[:60]}")
                    continue

        # Final upsert
        if upsert_buffer:
            upsert_to_pinecone(PINECONE_INDEX, upsert_buffer)
            logs.append(f"⤴️ Final upsert: {len(upsert_buffer)}")

        # Cleanup
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass

        logs.append(f"🎉 Done! {chunks_count} chunks")
        return IngestResponse(status="success", logs=logs, chunks_ingested=chunks_count)

    except Exception as e:
        logs.append(f"❌ {str(e)}")
        raise HTTPException(status_code=500, detail={"logs": logs, "error": str(e)})


@app.post("/api/explain", response_model=ExplainResponse)
def explain_code(req: ExplainRequest):
    """Explain code with RAG."""
    try:
        if not GEMINI_API_KEY:
            raise Exception("GEMINI_API_KEY not set")

        query_embedding = make_gemini_embedding(req.query)
        matches = query_pinecone(query_embedding, top_k=5)
        
        context = "\n".join([
            f"File: {m.get('metadata', {}).get('path', 'unknown')}"
            for m in matches if m.get('metadata')
        ])

        prompt = f"Explain this code:\n\n{req.query}\n\nContext:\n{context}"

        gen_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
        headers = {"Content-Type": "application/json"}
        params = {}
        
        if GEMINI_API_KEY:
            if GEMINI_API_KEY.startswith("AIza"):
                params = {"key": GEMINI_API_KEY}
            else:
                headers["Authorization"] = f"Bearer {GEMINI_API_KEY}"

        resp = requests.post(gen_url, headers=headers, params=params, 
                            json={"contents": [{"parts": [{"text": prompt}]}]}, 
                            timeout=60)
        
        if resp.status_code != 200:
            raise Exception(f"Gemini failed: {resp.status_code}")

        data = resp.json()
        answer = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "No response")

        return ExplainResponse(answer=answer)

    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


@app.post("/api/debug", response_model=DebugResponse)
def debug_commit(req: DebugRequest):
    """Analyze a commit."""
    try:
        parts = req.commit_url.rstrip("/").split("/")
        if len(parts) < 2 or "commit" not in parts:
            raise Exception("Invalid commit URL")

        commit_sha = parts[-1]
        repo_path = "/".join(parts[-4:-1])
        
        resp = requests.get(f"https://api.github.com/repos/{repo_path}/commits/{commit_sha}", timeout=30)
        if resp.status_code != 200:
            raise Exception("Commit not found")

        commit_data = resp.json()
        files_changed = [f["filename"] for f in commit_data.get("files", [])]
        
        return DebugResponse(
            blast_radius=files_changed,
            pr_summary=f"Analyzed {len(files_changed)} changed files",
            diff=""
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


@app.post("/api/architecture", response_model=ArchitectureResponse)
def get_architecture(req: ArchitectureRequest = None):
    """Get architecture diagram."""
    nodes = [
        {"id": "client", "label": "Frontend (Next.js)", "x": 100, "y": 200, "color": "#06b6d4"},
        {"id": "api", "label": "Backend (FastAPI)", "x": 400, "y": 200, "color": "#6366f1"},
        {"id": "gemini", "label": "Google Gemini", "x": 700, "y": 100, "color": "#f59e0b"},
        {"id": "pinecone", "label": "Pinecone", "x": 700, "y": 300, "color": "#10b981"},
    ]
    
    edges = [
        {"from": "client", "to": "api", "label": "REST API"},
        {"from": "api", "to": "gemini", "label": "Embeddings"},
        {"from": "api", "to": "pinecone", "label": "Vector Search"},
    ]
    
    return ArchitectureResponse(nodes=nodes, edges=edges)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
