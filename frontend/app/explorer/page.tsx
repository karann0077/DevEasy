# backend/main.py

import os
import re
import io
import time
import json
import shutil
import zipfile
import hashlib
import tempfile
import logging
import traceback
from typing import List, Optional, Dict, Any, Tuple

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain.text_splitter import RecursiveCharacterTextSplitter
from pinecone import Pinecone, ServerlessSpec

# ==========================================================
# CONFIG
# ==========================================================

EMBED_DIM = 768
DEFAULT_CHUNK_SIZE = 1200
DEFAULT_CHUNK_OVERLAP = 200
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "deveasy-index")

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")

GEMINI_EMBED_MODEL = "text-embedding-004"
GEMINI_GEN_MODEL = "gemini-1.5-flash"

# IMPORTANT: change region if needed
PINECONE_REGION = os.getenv("PINECONE_REGION", "us-east-1")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("deveasy-backend")

# ==========================================================
# FASTAPI INIT
# ==========================================================

app = FastAPI(title="DevEasy Backend")

if ALLOWED_ORIGIN == "*" or not ALLOWED_ORIGIN:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[ALLOWED_ORIGIN],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# ==========================================================
# MODELS
# ==========================================================

class IngestRequest(BaseModel):
    repo_url: str
    index_name: Optional[str] = PINECONE_INDEX_NAME


class ExplainRequest(BaseModel):
    query: str
    index_name: Optional[str] = PINECONE_INDEX_NAME


class DebugRequest(BaseModel):
    commit_url: str
    index_name: Optional[str] = PINECONE_INDEX_NAME


class DocsRequest(BaseModel):
    file_path: str
    repo_name: Optional[str] = None
    index_name: Optional[str] = PINECONE_INDEX_NAME


class FilesRequest(BaseModel):
    repo_name: Optional[str] = None
    index_name: Optional[str] = PINECONE_INDEX_NAME


class FileContentRequest(BaseModel):
    file_path: str
    repo_name: Optional[str] = None
    index_name: Optional[str] = PINECONE_INDEX_NAME


# ==========================================================
# UTILITIES
# ==========================================================

def ensure_envs():
    if not PINECONE_API_KEY:
        raise RuntimeError("PINECONE_API_KEY missing")
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY missing")


def append_log(logs: List[str], msg: str):
    logs.append(msg)
    logger.info(msg)


def parse_github_url(url: str) -> Tuple[str, str]:
    m = re.match(r"https?://github\.com/([^/]+)/([^/]+)", url)
    if not m:
        raise ValueError("Invalid GitHub URL")
    return m.group(1), m.group(2).replace(".git", "")


def parse_commit_url(url: str) -> Tuple[str, str, str]:
    """Parse a GitHub commit URL into (owner, repo, sha)."""
    m = re.match(r"https?://github\.com/([^/]+)/([^/]+)/commit/([a-fA-F0-9]+)", url)
    if not m:
        raise ValueError("Invalid GitHub commit URL. Expected format: https://github.com/owner/repo/commit/sha")
    return m.group(1), m.group(2).replace(".git", ""), m.group(3)


def safe_hash(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()


# ==========================================================
# GEMINI (REAL GOOGLE ENDPOINT)
# ==========================================================

def gemini_embed_texts(texts: List[str]) -> List[List[float]]:
    url = f"https://generativelanguage.googleapis.com/v1/models/{GEMINI_EMBED_MODEL}:embedContent?key={GEMINI_API_KEY}"
    vectors = []

    for text in texts:
        body = {
            "content": {
                "parts": [{"text": text}]
            }
        }

        resp = requests.post(url, json=body, timeout=60)
        if resp.status_code != 200:
            raise RuntimeError(f"Gemini embed failed: {resp.text}")

        data = resp.json()
        vec = data["embedding"]["values"]

        if len(vec) != EMBED_DIM:
            raise RuntimeError(f"Embedding dimension mismatch. Expected 768 got {len(vec)}")

        vectors.append(vec)

    return vectors


def gemini_generate(prompt: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1/models/{GEMINI_GEN_MODEL}:generateContent?key={GEMINI_API_KEY}"

    body = {
        "contents": [
            {"parts": [{"text": prompt}]}
        ]
    }

    resp = requests.post(url, json=body, timeout=90)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini generate failed: {resp.text}")

    data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


# ==========================================================
# PINECONE v3
# ==========================================================

def get_index(index_name: str):
    pc = Pinecone(api_key=PINECONE_API_KEY)

    existing = pc.list_indexes().names()

    if index_name not in existing:
        pc.create_index(
            name=index_name,
            dimension=EMBED_DIM,
            metric="cosine",
            spec=ServerlessSpec(
                cloud="aws",
                region=PINECONE_REGION
            )
        )

    return pc.Index(index_name)


# ==========================================================
# ENDPOINTS
# ==========================================================

@app.get("/health")
def health():
    return {"status": "ok", "time": int(time.time())}


@app.post("/api/ingest")
def ingest(req: IngestRequest):
    logs = []
    ensure_envs()
    tmpdir = None

    try:
        owner, repo = parse_github_url(req.repo_url)
        append_log(logs, f"Parsed repo {owner}/{repo}")

        headers = {"User-Agent": "DevEasy"}
        if GITHUB_TOKEN:
            headers["Authorization"] = f"token {GITHUB_TOKEN}"

        zip_url = f"https://api.github.com/repos/{owner}/{repo}/zipball"
        r = requests.get(zip_url, headers=headers)

        if r.status_code != 200:
            raise RuntimeError("Failed to download repo")

        tmpdir = tempfile.mkdtemp()
        zip_path = os.path.join(tmpdir, "repo.zip")

        with open(zip_path, "wb") as f:
            f.write(r.content)

        files = []

        with zipfile.ZipFile(zip_path, "r") as z:
            for info in z.infolist():
                if info.filename.endswith((".py", ".js", ".ts", ".java")):
                    content = z.read(info).decode(errors="replace")
                    files.append((info.filename, content))

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=DEFAULT_CHUNK_SIZE,
            chunk_overlap=DEFAULT_CHUNK_OVERLAP
        )

        index = get_index(req.index_name)

        total = 0

        for path, content in files:
            chunks = splitter.split_text(content)

            for i, chunk in enumerate(chunks):
                vector = gemini_embed_texts([chunk])[0]

                index.upsert(vectors=[{
                    "id": f"{repo}-{safe_hash(path + str(i))}",
                    "values": vector,
                    "metadata": {
                        "repo": repo,
                        "path": path,
                        "text": chunk
                    }
                }])

                total += 1

        append_log(logs, f"Ingestion complete: {total} chunks")

        return {"status": "success", "logs": logs, "chunks_ingested": total}

    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail={"error": str(e), "trace": tb})
    finally:
        # FIX #5: Clean up temp directory to prevent disk space leaks
        if tmpdir and os.path.exists(tmpdir):
            shutil.rmtree(tmpdir, ignore_errors=True)


@app.post("/api/explain")
def explain(req: ExplainRequest):
    ensure_envs()

    try:
        index = get_index(req.index_name)

        query_vec = gemini_embed_texts([req.query])[0]

        results = index.query(vector=query_vec, top_k=5, include_metadata=True)

        context = ""
        sources = []

        for m in results["matches"]:
            md = m["metadata"]
            context += f"\n--- {md['path']} ---\n{md['text'][:1200]}\n"
            sources.append(md["path"])

        prompt = f"""
Use the following context to answer:

{context}

Question:
{req.query}

Answer in markdown with:
- Direct answer
- Source files used
- Architecture impact
- Risks
"""

        answer = gemini_generate(prompt)

        return {"answer": answer, "sources": sources}

    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail={"error": str(e), "trace": tb})


# FIX #4: Implement real debug endpoint instead of stub
@app.post("/api/debug")
def debug(req: DebugRequest):
    ensure_envs()

    try:
        owner, repo, sha = parse_commit_url(req.commit_url)

        # Fetch commit data from GitHub API
        headers = {"User-Agent": "DevEasy", "Accept": "application/vnd.github.v3+json"}
        if GITHUB_TOKEN:
            headers["Authorization"] = f"token {GITHUB_TOKEN}"

        commit_api_url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
        r = requests.get(commit_api_url, headers=headers, timeout=30)

        if r.status_code != 200:
            raise RuntimeError(f"Failed to fetch commit from GitHub: {r.status_code} {r.text[:200]}")

        commit_data = r.json()

        # Extract blast radius (changed files)
        blast_radius = []
        diff_text = ""
        for file_info in commit_data.get("files", []):
            blast_radius.append(file_info.get("filename", "unknown"))
            status = file_info.get("status", "modified")
            patch = file_info.get("patch", "")
            diff_text += f"\n--- {file_info.get('filename', 'unknown')} ({status}) ---\n{patch}\n"

        # Get commit message
        commit_message = commit_data.get("commit", {}).get("message", "No commit message")

        # Generate AI analysis using Gemini
        prompt = f"""You are an expert code reviewer. Analyze the following Git commit and provide:

1. **Root Cause Analysis**: What does this commit change and why might it cause issues?
2. **Blast Radius Assessment**: What parts of the system are affected?
3. **Risk Analysis**: What are the potential risks of this change?
4. **Recommendations**: What should be checked or fixed?

Commit message: {commit_message}
Repository: {owner}/{repo}
Changed files: {', '.join(blast_radius)}

Diff:
{diff_text[:4000]}

Provide your analysis in markdown format."""

        pr_summary = gemini_generate(prompt)

        return {
            "blast_radius": blast_radius,
            "pr_summary": pr_summary,
            "diff": diff_text
        }

    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail={"error": str(e), "trace": tb})


# FIX #1: Add /api/docs endpoint
@app.post("/api/docs")
def docs(req: DocsRequest):
    ensure_envs()

    try:
        index = get_index(req.index_name)

        # Search for chunks matching the file path
        query_text = f"Documentation for file: {req.file_path}"
        query_vec = gemini_embed_texts([query_text])[0]

        # Build metadata filter if repo_name is provided
        filter_dict = {}
        if req.repo_name:
            filter_dict["repo"] = req.repo_name

        results = index.query(
            vector=query_vec,
            top_k=10,
            include_metadata=True,
            filter=filter_dict if filter_dict else None
        )

        # Gather context from matching chunks
        context = ""
        for m in results["matches"]:
            md = m["metadata"]
            context += f"\n--- {md['path']} ---\n{md['text'][:1200]}\n"

        if not context.strip():
            context = f"(No ingested code found for file: {req.file_path}. Generate general documentation based on the file name.)"

        prompt = f"""Generate comprehensive developer documentation for the file: {req.file_path}

Use the following code context from the ingested codebase:

{context}

Generate documentation in markdown format that includes:
- **Overview**: What this file does
- **Key Functions/Classes**: List and describe the main components
- **Data Flow**: How data moves through this file
- **Dependencies**: What this file depends on
- **Architecture Notes**: How this fits into the larger system
"""

        documentation = gemini_generate(prompt)

        return {"file_path": req.file_path, "documentation": documentation}

    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail={"error": str(e), "trace": tb})


# FIX #2: Add /api/files endpoint
@app.post("/api/files")
def list_files(req: FilesRequest):
    ensure_envs()

    try:
        index = get_index(req.index_name)

        # Query with a generic vector to get file listings
        query_text = f"list all files{' in ' + req.repo_name if req.repo_name else ''}"
        query_vec = gemini_embed_texts([query_text])[0]

        filter_dict = {}
        if req.repo_name:
            filter_dict["repo"] = req.repo_name

        results = index.query(
            vector=query_vec,
            top_k=100,
            include_metadata=True,
            filter=filter_dict if filter_dict else None
        )

        # Deduplicate files by path
        seen = set()
        files = []
        for m in results["matches"]:
            md = m["metadata"]
            path = md.get("path", "")
            repo = md.get("repo", "")
            key = f"{repo}:{path}"
            if key not in seen:
                seen.add(key)
                files.append({"path": path, "repo_name": repo})

        return {"files": files}

    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail={"error": str(e), "trace": tb})


# FIX #3: Add /api/file-content endpoint
@app.post("/api/file-content")
def file_content(req: FileContentRequest):
    ensure_envs()

    try:
        index = get_index(req.index_name)

        # Search for chunks from this specific file
        query_text = f"Content of file: {req.file_path}"
        query_vec = gemini_embed_texts([query_text])[0]

        filter_dict = {}
        if req.repo_name:
            filter_dict["repo"] = req.repo_name

        results = index.query(
            vector=query_vec,
            top_k=50,
            include_metadata=True,
            filter=filter_dict if filter_dict else None
        )

        # Reassemble content from matching chunks (filter by path)
        chunks = []
        for m in results["matches"]:
            md = m["metadata"]
            if req.file_path in md.get("path", ""):
                chunks.append(md.get("text", ""))

        content = "\n".join(chunks) if chunks else f"No content found for file: {req.file_path}"

        return {"file_path": req.file_path, "content": content}

    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail={"error": str(e), "trace": tb})


@app.post("/api/architecture")
def architecture():
    return {
        "nodes": [
            {"id": "client", "label": "Client"},
            {"id": "backend", "label": "Backend"},
            {"id": "gemini", "label": "Gemini"},
            {"id": "pinecone", "label": "Pinecone"},
        ],
        "edges": [
            {"from": "client", "to": "backend"},
            {"from": "backend", "to": "gemini"},
            {"from": "backend", "to": "pinecone"},
        ],
    }
