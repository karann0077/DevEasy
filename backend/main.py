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

# IMPORTANT: Clear system proxies to avoid Render / environment network issues
os.environ.pop('http_proxy', None)
os.environ.pop('https_proxy', None)
os.environ.pop('HTTP_PROXY', None)
os.environ.pop('HTTPS_PROXY', None)

app = FastAPI(title="InnovateBHARAT AI Engine", version="1.0.0")

# ==================== CORS CONFIGURATION ====================
# For production: Accept from your Vercel domain
# For development: Accept from localhost

ALLOWED_ORIGINS = []

# Get environment-specific settings
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
VERCEL_URL = os.getenv("VERCEL_URL")
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL")

# Determine allowed origins based on deployment environment
if ENVIRONMENT == "production":
    # Production: Allow only your Vercel domain
    ALLOWED_ORIGINS = [
        "https://innovate-bharat.vercel.app",  # Change this to your actual Vercel domain
        "https://www.innovate-bharat.vercel.app",
    ]
    # If VERCEL_URL is set (means we're in Vercel), add it
    if VERCEL_URL:
        ALLOWED_ORIGINS.append(f"https://{VERCEL_URL}")
else:
    # Development: Allow localhost and all origins
    ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
        "*",  # Allow all in development
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if ENVIRONMENT == "production" else ["*"],
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

# -------------------- Config from environment --------------------
# These should be set as environment variables in Render dashboard
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_ENV = os.getenv("PINECONE_ENV") or os.getenv("PINECONE_REGION")
PINECONE_INDEX = os.getenv("PINECONE_INDEX") or os.getenv("PINECONE_INDEX_NAME")

# Port configuration - Render sets this automatically
PORT = int(os.getenv("PORT", 8000))

# Validation with helpful messages
CONFIG_VALID = True
if not GEMINI_API_KEY:
    print("⚠️  WARNING: GEMINI_API_KEY not configured")
    print("   Set it in Render dashboard: Settings → Environment Variables")
    CONFIG_VALID = False
if not PINECONE_API_KEY or not PINECONE_ENV or not PINECONE_INDEX:
    print("⚠️  WARNING: Pinecone variables incomplete:")
    print(f"   PINECONE_API_KEY: {'✓ SET' if PINECONE_API_KEY else '✗ MISSING'}")
    print(f"   PINECONE_ENV: {'✓ SET' if PINECONE_ENV else '✗ MISSING'}")
    print(f"   PINECONE_INDEX: {'✓ SET' if PINECONE_INDEX else '✗ MISSING'}")
    print("   Set in Render dashboard: Settings → Environment Variables")
    CONFIG_VALID = False

if ENVIRONMENT == "production":
    print(f"✓ Production Mode - CORS restricted to: {ALLOWED_ORIGINS}")
else:
    print("ℹ️  Development Mode - CORS open to all origins")

# -------------------- Utility helpers --------------------
ALLOWED_EXT = {".py", ".js", ".ts", ".jsx", ".tsx", ".cpp", ".c", ".h", ".md", ".json", ".yaml", ".yml", ".html", ".css"}
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
EMBED_DELAY = 0.25  # seconds between embedding requests
UPSERT_BATCH = 100

# Initialize text splitter
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    separators=["\n\n", "\n", " ", ""]
)

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
    """Call Gemini embedding REST endpoint. Returns a list[float] of 768 dimensions."""
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
        "content": {
            "parts": [{"text": text}]
        },
        "outputDimensionality": 768
    }

    try:
        resp = requests.post(url, headers=headers, params=params, json=body, timeout=60)
        if resp.status_code != 200:
            error_detail = resp.text[:500]
            raise Exception(f"Gemini embedding failed: {resp.status_code} - {error_detail}")

        data = resp.json()
        
        if "embedding" in data:
            vec = data["embedding"].get("values", [])
        else:
            raise Exception(f"Unexpected Gemini response format: {json.dumps(data)[:200]}")

        if not isinstance(vec, list):
            raise Exception(f"Embedding not a list: {type(vec)}")

        vec = [float(x) for x in vec]
        
        # Ensure exactly 768 dimensions
        if len(vec) > 768:
            vec = vec[:768]
        elif len(vec) < 768:
            vec = vec + [0.0] * (768 - len(vec))
        
        return vec
    except Exception as e:
        raise Exception(f"Gemini embedding error: {str(e)}")

# -------------------- Pinecone helper --------------------
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
    """Upsert a batch of vectors to Pinecone."""
    if not PINECONE_AVAILABLE:
        raise Exception("pinecone library is not available. Install: pip install pinecone-client")

    if not PINECONE_API_KEY or not PINECONE_ENV or not PINECONE_INDEX:
        raise Exception("Pinecone credentials missing (PINECONE_API_KEY, PINECONE_ENV, PINECONE_INDEX)")

    try:
        # Try modern Pinecone SDK (v3+)
        try:
            from pinecone import Pinecone
            pc = Pinecone(api_key=PINECONE_API_KEY)
            index = pc.Index(index_name, host=PINECONE_ENV)
            
            upsert_vectors = [
                {
                    "id": v["id"],
                    "values": v["values"],
                    "metadata": v.get("metadata", {})
                }
                for v in vectors
            ]
            index.upsert(vectors=upsert_vectors)
        except Exception as e_new:
            # Fall back to older SDK (v2)
            import pinecone
            pinecone.init(api_key=PINECONE_API_KEY, environment=PINECONE_ENV)
            index = pinecone.Index(index_name)
            
            upsert_tuples = [
                (v["id"], v["values"], v.get("metadata", {}))
                for v in vectors
            ]
            index.upsert(vectors=upsert_tuples)
    except Exception as e:
        raise Exception(f"Pinecone upsert failed: {str(e)}")

def query_pinecone(query_embedding: list, top_k: int = 5) -> List[dict]:
    """Query Pinecone for similar chunks."""
    if not PINECONE_AVAILABLE:
        return []

    if not PINECONE_API_KEY or not PINECONE_ENV or not PINECONE_INDEX:
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
        print(f"Pinecone query error: {e}")
        return []

# -------------------- Endpoints --------------------

@app.get("/health")
def health_check():
    """Health check endpoint - used by Render to verify service is running"""
    return {
        "status": "ok",
        "service": "InnovateBHARAT AI Engine",
        "environment": ENVIRONMENT,
        "pinecone_available": PINECONE_AVAILABLE,
        "gemini_key_set": bool(GEMINI_API_KEY),
        "config_valid": CONFIG_VALID,
        "port": PORT
    }

@app.get("/")
def root():
    """Root endpoint"""
    return {
        "service": "InnovateBHARAT AI Engine",
        "version": "1.0.0",
        "endpoints": [
            "/health",
            "/api/ingest",
            "/api/explain",
            "/api/debug",
            "/api/architecture"
        ]
    }

@app.post("/api/ingest", response_model=IngestResponse)
def ingest_repo(req: IngestRequest):
    """Ingest a GitHub repository and vectorize its code."""
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
                raise Exception(f"GitHub download failed: {r.status_code}")
            tmpdir = tempfile.mkdtemp(prefix="ingest_")
            zpath = os.path.join(tmpdir, "repo.zip")
            with open(zpath, "wb") as f:
               # ✅ RIGHT: Track size while downloading
downloaded_size = 0
for chunk in r.iter_content(chunk_size=8192):
    if chunk:
        f.write(chunk)
        downloaded_size += len(chunk)

# Then use the tracked size
logs.append(f"✅ Downloaded {downloaded_size / (1024*1024):.1f} MB")

        extract_dir = os.path.join(tmpdir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zpath, 'r') as z:
            z.extractall(extract_dir)
        logs.append(f"✅ Extracted files")

        # Walk files and collect valid code files
        file_entries = []
        for root, _, files in os.walk(extract_dir):
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext in ALLOWED_EXT:
                    abs_path = os.path.join(root, fname)
                    rel_path = os.path.relpath(abs_path, extract_dir)
                    file_entries.append((abs_path, rel_path))
        logs.append(f"📄 Found {len(file_entries)} valid source files")

        if not file_entries:
            raise Exception("No source files found matching allowed extensions")

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
                    logs.append(f"⚠️  Skipping binary/unreadable: {rel_path}")
                    continue
            except Exception as e:
                logs.append(f"⚠️  Error reading {rel_path}: {str(e)[:50]}")
                continue

            # Use LangChain text splitter for semantic chunking
            chunks = text_splitter.split_text(text)
            
            for i, chunk in enumerate(chunks):
                if not chunk.strip():
                    continue
                    
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
                    logs.append(f"⚠️  Embedding failed for {rel_path}@{i}: {str(e)[:60]}")
                    continue

                if vec is None or len(vec) != 768:
                    continue

                upsert_buffer.append({
                    "id": chunk_id,
                    "values": vec,
                    "metadata": metadata,
                })
                chunks_count += 1

                if len(upsert_buffer) >= UPSERT_BATCH:
                    try:
                        upsert_to_pinecone(PINECONE_INDEX, upsert_buffer)
                        logs.append(f"⤴️  Upserted {len(upsert_buffer)} vectors")
                    except Exception as e:
                        logs.append(f"⚠️  Upsert batch failed: {str(e)[:80]}")
                    upsert_buffer = []

                time.sleep(EMBED_DELAY)

        if upsert_buffer:
            try:
                upsert_to_pinecone(PINECONE_INDEX, upsert_buffer)
                logs.append(f"⤴️  Upserted final {len(upsert_buffer)} vectors")
            except Exception as e:
                logs.append(f"⚠️  Final upsert failed: {str(e)[:80]}")

        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass

        logs.append(f"🎉 Ingestion complete! {chunks_count} chunks vectorized")
        return IngestResponse(status="success", logs=logs, chunks_ingested=chunks_count)

    except Exception as e:
        logs.append(f"❌ ERROR: {str(e)}")
        logs.append(traceback.format_exc()[:200])
        raise HTTPException(status_code=500, detail={"logs": logs, "error": str(e)})


@app.post("/api/explain", response_model=ExplainResponse)
def explain_code(req: ExplainRequest):
    """Explain code using RAG context from Pinecone."""
    try:
        if not GEMINI_API_KEY:
            raise Exception("GEMINI_API_KEY not configured")

        # Generate embedding for the query
        try:
            query_embedding = make_gemini_embedding(req.query)
        except Exception as e:
            raise Exception(f"Failed to embed query: {str(e)}")

        # Query Pinecone for relevant chunks
        matches = query_pinecone(query_embedding, top_k=5)
        
        context_text = ""
        if matches:
            context_text = "\n\n".join([
                f"File: {m.get('metadata', {}).get('path', 'unknown')}\n"
                f"Content: {m.get('metadata', {}).get('text', '')[:500]}"
                for m in matches if m.get('metadata')
            ])

        # Generate explanation using Gemini
        prompt = f"""You are an expert code architect. Analyze the following code query and context:

QUERY: {req.query}

CONTEXT FROM CODEBASE:
{context_text if context_text else "No context available - database may be empty"}

Provide a clear, structured explanation covering:
1. **Purpose**: What does this code do?
2. **Architecture**: How does it fit into the system?
3. **Concerns**: Any performance, security, or design issues?
4. **Connections**: How does it interact with other parts?

Format your response in markdown with clear sections."""

        gen_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
        headers = {"Content-Type": "application/json"}
        params = {}
        
        if GEMINI_API_KEY:
            if GEMINI_API_KEY.startswith("AIza"):
                params = {"key": GEMINI_API_KEY}
            else:
                headers["Authorization"] = f"Bearer {GEMINI_API_KEY}"

        body = {
            "contents": [{
                "parts": [{"text": prompt}]
            }]
        }

        resp = requests.post(gen_url, headers=headers, params=params, json=body, timeout=60)
        if resp.status_code != 200:
            raise Exception(f"Gemini generation failed: {resp.status_code} - {resp.text[:200]}")

        data = resp.json()
        answer = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "No response")

        return ExplainResponse(answer=answer)

    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e), "logs": [str(e)]})


@app.post("/api/debug", response_model=DebugResponse)
def debug_commit(req: DebugRequest):
    """Analyze a Git commit for potential regressions (Blast Radius)."""
    try:
        if not GEMINI_API_KEY:
            raise Exception("GEMINI_API_KEY not configured")

        # Parse GitHub commit URL
        parts = req.commit_url.rstrip("/").split("/")
        if len(parts) < 2 or "commit" not in parts:
            raise Exception("Invalid commit URL format")

        commit_sha = parts[-1]
        repo_path = "/".join(parts[-4:-1])
        
        # Fetch commit diff from GitHub
        diff_url = f"https://api.github.com/repos/{repo_path}/commits/{commit_sha}"
        resp = requests.get(diff_url, timeout=30)
        if resp.status_code != 200:
            raise Exception(f"GitHub commit fetch failed: {resp.status_code}")

        commit_data = resp.json()
        files_changed = commit_data.get("files", [])
        
        # Build diff text and identify changed files
        diff_text = ""
        changed_files = []
        for file in files_changed:
            changed_files.append(file["filename"])
            diff_text += f"\n--- {file['filename']}\n"
            diff_text += f"+++ {file['filename']}\n"
            diff_text += file.get("patch", "")[:500]

        # Generate blast radius analysis using Gemini
        analysis_prompt = f"""You are a code reviewer analyzing a Git commit for potential regression impact.

CHANGED FILES:
{chr(10).join(changed_files)}

DIFF SAMPLE:
{diff_text[:1500]}

Based on the changes, identify which files/systems might break due to these changes.
Return a JSON object with:
{{
  "blast_radius": ["file1.py", "file2.js", ...],
  "pr_summary": "Brief explanation of what changed and why it might break other systems"
}}"""

        gen_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
        headers = {"Content-Type": "application/json"}
        params = {}
        
        if GEMINI_API_KEY:
            if GEMINI_API_KEY.startswith("AIza"):
                params = {"key": GEMINI_API_KEY}
            else:
                headers["Authorization"] = f"Bearer {GEMINI_API_KEY}"

        body = {
            "contents": [{
                "parts": [{"text": analysis_prompt}]
            }]
        }

        resp = requests.post(gen_url, headers=headers, params=params, json=body, timeout=60)
        if resp.status_code != 200:
            raise Exception(f"Gemini analysis failed: {resp.status_code}")

        data = resp.json()
        analysis_text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")

        # Try to parse JSON from response
        blast_radius = []
        pr_summary = analysis_text
        
        try:
            import re
            json_match = re.search(r'\{.*\}', analysis_text, re.DOTALL)
            if json_match:
                analysis_obj = json.loads(json_match.group())
                blast_radius = analysis_obj.get("blast_radius", changed_files)
                pr_summary = analysis_obj.get("pr_summary", analysis_text)
        except:
            blast_radius = changed_files
            pr_summary = analysis_text

        return DebugResponse(
            blast_radius=blast_radius,
            pr_summary=pr_summary,
            diff=diff_text
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e), "logs": [str(e)]})


@app.post("/api/architecture", response_model=ArchitectureResponse)
def get_architecture(req: ArchitectureRequest = None):
    """Return the system architecture diagram data."""
    try:
        nodes = [
            {
                "id": "client",
                "label": "Client (Next.js)",
                "x": 80,
                "y": 220,
                "color": "#06b6d4",
            },
            {
                "id": "api",
                "label": "FastAPI Backend",
                "x": 380,
                "y": 220,
                "color": "#6366f1",
            },
            {
                "id": "gemini",
                "label": "Google Gemini",
                "x": 650,
                "y": 80,
                "color": "#f59e0b",
            },
            {
                "id": "pinecone",
                "label": "Pinecone Vector DB",
                "x": 650,
                "y": 360,
                "color": "#10b981",
            },
            {
                "id": "github",
                "label": "GitHub API",
                "x": 380,
                "y": 440,
                "color": "#8b5cf6",
            },
        ]

        edges = [
            {"from": "client", "to": "api", "label": "REST /api/*"},
            {"from": "api", "to": "gemini", "label": "Embed & Generate"},
            {"from": "api", "to": "pinecone", "label": "Upsert / Query"},
            {"from": "api", "to": "github", "label": "Zipball / Commits"},
        ]

        return ArchitectureResponse(nodes=nodes, edges=edges)

    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
