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


@app.post("/api/debug")
def debug(req: DebugRequest):
    ensure_envs()

    try:
        return {"message": "Debug endpoint ready (simplified version)"}
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
