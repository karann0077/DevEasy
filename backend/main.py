import os
import time
import json
import uuid
import zipfile
import shutil
import tempfile
import traceback
import re
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

# CORS Configuration - allow all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_HOST = os.getenv("PINECONE_HOST")
PINECONE_INDEX = os.getenv("PINECONE_INDEX") or os.getenv("PINECONE_INDEX_NAME")
PORT = int(os.getenv("PORT", 8000))

# Startup logs
print(f"GEMINI_API_KEY set: {bool(GEMINI_API_KEY)}")
print(f"GROQ_API_KEY set: {bool(GROQ_API_KEY)}")
print(f"PINECONE_API_KEY set: {bool(PINECONE_API_KEY)}")
print(f"PINECONE_HOST: {PINECONE_HOST}")
print(f"PINECONE_INDEX: {PINECONE_INDEX}")

# Constants
ALLOWED_EXT = {".py", ".js", ".ts", ".jsx", ".tsx", ".md"}
CHUNK_SIZE = 2000
CHUNK_OVERLAP = 150
EMBED_DIM = 3072
EMBED_DELAY = 1.5
UPSERT_BATCH = 100
EMBED_BATCH_SIZE = 50

# Groq generation models ordered by preference (fast + generous free tier)
GROQ_GENERATION_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "gemma2-9b-it",
]

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


def make_gemini_embeddings_batch(texts: List[str]) -> List[list]:
    """
    Batch embed up to EMBED_BATCH_SIZE texts in a single API call using
    batchEmbedContents. Returns a list of vectors in the same order as texts.
    FIX: Replaces per-chunk make_gemini_embedding() calls during ingestion.
    """
    if not texts:
        return []
    if not GEMINI_API_KEY:
        raise Exception("GEMINI_API_KEY is not set")

    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents"
    params = {"key": GEMINI_API_KEY}
    headers = {"Content-Type": "application/json"}
    body = {
        "requests": [
            {
                "model": "models/gemini-embedding-001",
                "content": {"parts": [{"text": t}]},
                "outputDimensionality": EMBED_DIM
            }
            for t in texts
        ]
    }

    try:
        resp = requests.post(url, headers=headers, params=params, json=body, timeout=60)
        if resp.status_code == 429:
            raise Exception("QUOTA_EXCEEDED:60")
        if resp.status_code != 200:
            error_detail = ""
            try:
                error_detail = resp.json().get("error", {}).get("message", resp.text[:300])
            except Exception:
                error_detail = resp.text[:300]
            raise Exception(f"Gemini batch embed error {resp.status_code}: {error_detail}")

        data = resp.json()
        results = []
        for emb in data.get("embeddings", []):
            vec = emb.get("values", [])
            vec = [float(x) for x in vec]
            if len(vec) > EMBED_DIM:
                vec = vec[:EMBED_DIM]
            elif len(vec) < EMBED_DIM:
                vec = vec + [0.0] * (EMBED_DIM - len(vec))
            results.append(vec if vec else None)
        return results
    except requests.exceptions.Timeout:
        raise Exception("Gemini batch embed request timed out")
    except Exception as e:
        raise


def make_gemini_embedding(text: str) -> list:
    """Generate a single 3072-dim embedding. Used for query-time (not ingestion)."""
    if not text or not text.strip():
        return None
    if not GEMINI_API_KEY:
        raise Exception("GEMINI_API_KEY is not set")

    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent"
    params = {"key": GEMINI_API_KEY}
    headers = {"Content-Type": "application/json"}
    body = {
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
        "outputDimensionality": EMBED_DIM
    }

    try:
        resp = requests.post(url, headers=headers, params=params, json=body, timeout=30)
        if resp.status_code != 200:
            error_detail = ""
            try:
                error_detail = resp.json().get("error", {}).get("message", resp.text)
            except Exception:
                error_detail = resp.text
            raise Exception(f"Gemini API error {resp.status_code}: {error_detail}")

        data = resp.json()
        vec = data.get("embedding", {}).get("values", [])
        if not vec:
            raise Exception("Empty embedding returned from Gemini")
        vec = [float(x) for x in vec]
        if len(vec) > EMBED_DIM:
            vec = vec[:EMBED_DIM]
        elif len(vec) < EMBED_DIM:
            vec = vec + [0.0] * (EMBED_DIM - len(vec))
        return vec
    except requests.exceptions.Timeout:
        raise Exception("Gemini API request timed out")
    except Exception as e:
        raise Exception(f"Embedding error: {str(e)}")


def make_gemini_generate(prompt: str) -> str:
    """Generate text using Groq with automatic model fallback.
    Function name kept as make_gemini_generate so all callers need zero changes.
    """
    if not GROQ_API_KEY:
        raise Exception("GROQ_API_KEY is not set. Please add it to your environment variables.")

    try:
        from groq import Groq
    except ImportError:
        raise Exception("groq package not installed. Run: pip install groq")

    client = Groq(api_key=GROQ_API_KEY)
    last_error = None

    for model in GROQ_GENERATION_MODELS:
        try:
            print(f"Trying Groq model: {model}")
            completion = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert software architect and developer. Provide clear, concise, and technically accurate responses. Format your response in Markdown."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.7,
                max_tokens=2048,
            )
            result = completion.choices[0].message.content
            if not result or not result.strip():
                raise Exception("Empty response from Groq")
            print(f"Groq model {model} succeeded")
            return result
        except Exception as e:
            err_str = str(e)
            print(f"Groq model {model} failed: {err_str[:200]}")
            last_error = err_str
            # If rate limited, try next model immediately (no sleep needed, Groq is fast)
            continue

    raise Exception(f"All Groq models failed. Last error: {last_error}")


# Pinecone Functions
try:
    from pinecone import Pinecone as PineconeClient
    PINECONE_AVAILABLE = True
    print("Pinecone SDK loaded (v3+)")
except ImportError:
    PINECONE_AVAILABLE = False
    print("Pinecone SDK not available")

def get_pinecone_index():
    """Get Pinecone index object."""
    if not PINECONE_AVAILABLE:
        raise Exception("Pinecone SDK not installed")
    if not PINECONE_API_KEY:
        raise Exception("PINECONE_API_KEY not set")
    if not PINECONE_INDEX:
        raise Exception("PINECONE_INDEX not set")
    pc = PineconeClient(api_key=PINECONE_API_KEY)
    if PINECONE_HOST:
        return pc.Index(host=PINECONE_HOST)
    else:
        return pc.Index(PINECONE_INDEX)

def upsert_to_pinecone(vectors: List[dict]):
    """Upsert vectors to Pinecone."""
    index = get_pinecone_index()
    index.upsert(vectors=vectors)

def query_pinecone(query_embedding: list, top_k: int = 5) -> List[dict]:
    """Query Pinecone for similar chunks."""
    if not PINECONE_AVAILABLE or not PINECONE_API_KEY:
        return []
    try:
        index = get_pinecone_index()
        results = index.query(vector=query_embedding, top_k=top_k, include_metadata=True)
        if hasattr(results, 'matches'):
            return results.matches
        return results.get("matches", [])
    except Exception as e:
        print(f"Pinecone query error: {e}")
        return []


# Endpoints
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "pinecone_available": PINECONE_AVAILABLE,
        "gemini_key_set": bool(GEMINI_API_KEY),
        "groq_key_set": bool(GROQ_API_KEY),
        "pinecone_key_set": bool(PINECONE_API_KEY),
        "pinecone_index": PINECONE_INDEX,
        "pinecone_host": PINECONE_HOST,
        "generation_models": GROQ_GENERATION_MODELS,
    }

@app.get("/")
def root():
    return {
        "service": "InnovateBHARAT AI Engine",
        "version": "1.0.0",
        "status": "running"
    }

@app.post("/api/ingest", response_model=IngestResponse)
def ingest_repo(req: IngestRequest):
    """Ingest a GitHub repository into Pinecone."""
    logs = []
    chunks_count = 0
    tmpdir = None

    try:
        logs.append(f"Starting ingestion for {req.repo_url}")
        logs.append("Using gemini-embedding-001 (3072-dim) with batch embedding. Ensure your Pinecone index dimension is 3072.")

        parsed = parse_github_repo(req.repo_url)
        if not parsed:
            raise Exception("Invalid GitHub URL. Use format: https://github.com/owner/repo")

        owner, repo = parsed
        zip_url = f"https://api.github.com/repos/{owner}/{repo}/zipball"
        logs.append(f"Downloading from {zip_url}")

        req_headers = {"User-Agent": "InnovateBHARAT/1.0"}
        tmpdir = tempfile.mkdtemp(prefix="ingest_")
        zpath = os.path.join(tmpdir, "repo.zip")
        downloaded_size = 0

        with requests.get(zip_url, stream=True, timeout=120, headers=req_headers) as r:
            if r.status_code == 404:
                raise Exception(f"Repository not found or is private: {req.repo_url}")
            if r.status_code != 200:
                raise Exception(f"Download failed with status {r.status_code}")
            with open(zpath, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded_size += len(chunk)

        logs.append(f"Downloaded {downloaded_size / (1024*1024):.1f} MB")

        extract_dir = os.path.join(tmpdir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zpath, 'r') as z:
            z.extractall(extract_dir)
        logs.append("Extracted")

        file_entries = []
        for root_dir, _, files in os.walk(extract_dir):
            for fname in files:
                rel = os.path.relpath(root_dir, extract_dir)
                if any(skip in rel for skip in ["node_modules", ".git", "__pycache__", ".next", "dist", "build"]):
                    continue
                ext = os.path.splitext(fname)[1].lower()
                if ext in ALLOWED_EXT:
                    abs_path = os.path.join(root_dir, fname)
                    rel_path = os.path.relpath(abs_path, extract_dir)
                    file_entries.append((abs_path, rel_path))

        logs.append(f"Found {len(file_entries)} files to process")

        if not file_entries:
            raise Exception("No supported code files found in repository")

        # FIX: Collect ALL chunks first, then embed in batches
        # This replaces the old per-chunk embedding loop which blew through quota
        all_chunks = []  # list of (rel_path, chunk_index, chunk_text)
        for abs_path, rel_path in file_entries:
            try:
                with open(abs_path, 'r', encoding='utf-8', errors='replace') as f:
                    text = f.read()
            except Exception as e:
                logs.append(f"Skipping {rel_path}: {e}")
                continue

            if not text.strip():
                continue

            chunks = text_splitter.split_text(text)
            for i, chunk in enumerate(chunks):
                if chunk.strip():
                    all_chunks.append((rel_path, i, chunk))

        logs.append(f"Total chunks to embed: {len(all_chunks)} (in batches of {EMBED_BATCH_SIZE})")

        upsert_buffer = []
        failed_embeds = 0
        total_batches = (len(all_chunks) + EMBED_BATCH_SIZE - 1) // EMBED_BATCH_SIZE

        for batch_num, batch_start in enumerate(range(0, len(all_chunks), EMBED_BATCH_SIZE)):
            batch = all_chunks[batch_start:batch_start + EMBED_BATCH_SIZE]
            texts = [c[2] for c in batch]

            try:
                vecs = make_gemini_embeddings_batch(texts)
            except Exception as e:
                err_str = str(e)
                failed_embeds += len(batch)
                logs.append(f"Batch {batch_num + 1}/{total_batches} failed: {err_str[:120]}")
                if "QUOTA_EXCEEDED" in err_str:
                    logs.append("Quota hit — waiting 60s before continuing...")
                    time.sleep(60)
                continue

            for (rel_path, chunk_idx, chunk_text), vec in zip(batch, vecs):
                if not vec:
                    failed_embeds += 1
                    continue
                upsert_buffer.append({
                    "id": str(uuid.uuid4()),
                    "values": vec,
                    "metadata": {
                        "repo": repo,
                        "repo_url": req.repo_url,
                        "path": rel_path,
                        "chunk_index": chunk_idx,
                        "text": chunk_text[:500]
                    }
                })
                chunks_count += 1

            if len(upsert_buffer) >= UPSERT_BATCH:
                upsert_to_pinecone(upsert_buffer)
                logs.append(f"Upserted {chunks_count} chunks so far...")
                upsert_buffer = []

            # Respectful delay between batch API calls
            time.sleep(EMBED_DELAY)

        # Final upsert for remaining buffer
        if upsert_buffer:
            upsert_to_pinecone(upsert_buffer)
            logs.append(f"Final upsert: {len(upsert_buffer)} chunks")

        try:
            if tmpdir:
                shutil.rmtree(tmpdir)
        except Exception:
            pass

        if failed_embeds > 0:
            logs.append(f"Warning: {failed_embeds} chunks failed to embed")

        logs.append(f"Done! {chunks_count} chunks ingested successfully")
        return IngestResponse(status="success", logs=logs, chunks_ingested=chunks_count)

    except Exception as e:
        logs.append(f"Fatal error: {str(e)}")
        raise HTTPException(status_code=500, detail={"logs": logs, "error": str(e)})


@app.post("/api/explain", response_model=ExplainResponse)
def explain_code(req: ExplainRequest):
    """Explain code using RAG pipeline."""
    try:
        if not GROQ_API_KEY:
            raise Exception("GROQ_API_KEY is not set")
        if not GEMINI_API_KEY:
            raise Exception("GEMINI_API_KEY is not set (required for embeddings)")

        query_embedding = make_gemini_embedding(req.query)
        matches = query_pinecone(query_embedding, top_k=5)

        context_parts = []
        for m in matches:
            meta = {}
            if hasattr(m, 'metadata'):
                meta = m.metadata or {}
            elif isinstance(m, dict):
                meta = m.get('metadata', {})

            path = meta.get('path', 'unknown')
            text = meta.get('text', '')
            if text:
                context_parts.append(f"--- File: {path} ---\n{text}")

        context = "\n\n".join(context_parts) if context_parts else "No relevant code found in the indexed repository."

        prompt = (
            "You are an expert software architect analyzing a codebase.\n\n"
            f"User Query: {req.query}\n\n"
            f"Relevant Code Context:\n{context}\n\n"
            "Please provide:\n"
            "1. A clear explanation of what this code does\n"
            "2. **Architectural Warnings** - any potential issues or risks\n"
            "3. System-wide impacts - how changes here might affect other parts\n\n"
            "Format your response in Markdown."
        )

        answer = make_gemini_generate(prompt)
        return ExplainResponse(answer=answer)

    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


@app.post("/api/debug", response_model=DebugResponse)
def debug_commit(req: DebugRequest):
    """Analyze a GitHub commit for blast radius."""
    try:
        parts = req.commit_url.rstrip("/").split("/")

        if "commit" not in parts:
            raise Exception("Invalid commit URL. Expected format: https://github.com/owner/repo/commit/SHA")

        commit_idx = parts.index("commit")
        if commit_idx < 2:
            raise Exception("Could not parse owner/repo from URL")

        commit_sha = parts[commit_idx + 1]
        owner = parts[commit_idx - 2]
        repo = parts[commit_idx - 1]

        req_headers = {"User-Agent": "InnovateBHARAT/1.0"}
        resp = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}/commits/{commit_sha}",
            headers=req_headers,
            timeout=30
        )

        if resp.status_code == 404:
            raise Exception("Commit not found or repository is private")
        if resp.status_code != 200:
            raise Exception(f"GitHub API error: {resp.status_code}")

        commit_data = resp.json()
        files_changed = commit_data.get("files", [])
        file_names = [f["filename"] for f in files_changed]

        diff_lines = []
        for f in files_changed[:5]:
            diff_lines.append(f"=== {f['filename']} ===")
            patch = f.get("patch", "")
            if patch:
                diff_lines.append(patch[:1000])
        diff_str = "\n".join(diff_lines)

        # FIX: was broken f-string with escaped braces {commit_sha[:8]}
        pr_summary = f"**Commit:** `{commit_sha[:8]}`\n\n**Changed Files ({len(file_names)}):**\n"
        for fname in file_names:
            pr_summary += f"- `{fname}`\n"

        if GROQ_API_KEY and diff_str:
            try:
                prompt = (
                    "Analyze this git commit diff and provide:\n"
                    "1. A concise PR summary (2-3 sentences)\n"
                    "2. Potential blast radius - which other parts of the system might be affected\n\n"
                    f"Diff:\n{diff_str[:2000]}"
                )
                ai_summary = make_gemini_generate(prompt)
                pr_summary += f"\n\n**AI Analysis:**\n{ai_summary}"
            except Exception as e:
                pr_summary += f"\n\n_AI analysis unavailable: {str(e)}_"

        return DebugResponse(
            blast_radius=file_names,
            pr_summary=pr_summary,
            diff=diff_str
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


@app.post("/api/architecture", response_model=ArchitectureResponse)
def get_architecture(req: ArchitectureRequest = None):
    """Get architecture diagram nodes and edges."""
    nodes = [
        {"id": "client", "label": "Frontend\n(Next.js)", "x": 100, "y": 200, "color": "#06b6d4"},
        {"id": "api", "label": "Backend\n(FastAPI)", "x": 400, "y": 200, "color": "#6366f1"},
        {"id": "gemini", "label": "Gemini Embeddings\n+ Groq LLM", "x": 700, "y": 100, "color": "#f59e0b"},
        {"id": "pinecone", "label": "Pinecone\n(Vector DB)", "x": 700, "y": 300, "color": "#10b981"},
        {"id": "github", "label": "GitHub\n(Source Repos)", "x": 100, "y": 50, "color": "#8b5cf6"},
    ]

    edges = [
        {"from": "client", "to": "api", "label": "REST API"},
        {"from": "api", "to": "gemini", "label": "Embeddings (Gemini) & Generation (Groq)"},
        {"from": "api", "to": "pinecone", "label": "Vector Upsert / Search"},
        {"from": "github", "to": "api", "label": "Repo Download"},
        {"from": "client", "to": "github", "label": "Commit URL"},
    ]

    return ArchitectureResponse(nodes=nodes, edges=edges)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
