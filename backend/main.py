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
from pinecone import Pinecone

# ---- CRITICAL: Clear proxies ----
for key in ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"]:
    os.environ.pop(key, None)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- CONFIG ----------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX = os.getenv("PINECONE_INDEX")

if not GEMINI_API_KEY:
    raise Exception("GEMINI_API_KEY missing")

if not PINECONE_API_KEY or not PINECONE_INDEX:
    raise Exception("Pinecone env vars missing")

pc = Pinecone(api_key=PINECONE_API_KEY)
index = pc.Index(PINECONE_INDEX)

ALLOWED_EXT = {".py", ".js", ".ts", ".jsx", ".tsx", ".cpp", ".c", ".h", ".md"}
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
EMBED_DELAY = 0.25
BATCH_SIZE = 50

# ---------------- MODELS ----------------
class IngestRequest(BaseModel):
    repo_url: str

class ExplainRequest(BaseModel):
    query: str

# ---------------- HELPERS ----------------

def parse_repo(url: str):
    parsed = urlparse(url)
    parts = parsed.path.strip("/").split("/")
    if len(parts) < 2:
        return None
    return parts[0], parts[1].replace(".git", "")


def chunk_text(text):
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        chunks.append(text[start:end])
        start = end - CHUNK_OVERLAP
    return chunks


def gemini_embed(text: str):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={GEMINI_API_KEY}"

    body = {
        "model": "models/text-embedding-004",
        "content": {
            "parts": [{"text": text}]
        },
        "outputDimensionality": 768
    }

    r = requests.post(url, json=body, timeout=60)

    if r.status_code != 200:
        raise Exception(f"Gemini error: {r.text}")

    data = r.json()

    vec = data["embedding"]["values"]

    # Ensure exactly 768
    if len(vec) > 768:
        vec = vec[:768]
    elif len(vec) < 768:
        vec += [0.0] * (768 - len(vec))

    return vec


def gemini_generate(prompt: str):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY}"

    body = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ]
    }

    r = requests.post(url, json=body, timeout=60)

    if r.status_code != 200:
        raise Exception(r.text)

    return r.json()["candidates"][0]["content"]["parts"][0]["text"]


# ---------------- INGEST ----------------

@app.post("/api/ingest")
def ingest(req: IngestRequest):
    logs = []
    total_chunks = 0

    try:
        owner, repo = parse_repo(req.repo_url)
        zip_url = f"https://api.github.com/repos/{owner}/{repo}/zipball"

        logs.append("Downloading repository...")
        r = requests.get(zip_url, timeout=60)
        if r.status_code != 200:
            raise Exception("GitHub download failed")

        tmp = tempfile.mkdtemp()
        zip_path = os.path.join(tmp, "repo.zip")

        with open(zip_path, "wb") as f:
            f.write(r.content)

        extract_path = os.path.join(tmp, "extracted")
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(extract_path)

        vectors = []

        for root, _, files in os.walk(extract_path):
            for file in files:
                if os.path.splitext(file)[1] in ALLOWED_EXT:
                    path = os.path.join(root, file)
                    with open(path, "r", encoding="utf-8", errors="ignore") as f:
                        text = f.read()

                    for chunk in chunk_text(text):
                        embedding = gemini_embed(chunk)

                        vectors.append({
                            "id": str(uuid.uuid4()),
                            "values": embedding,
                            "metadata": {
                                "repo": repo,
                                "path": file,
                                "text": chunk
                            }
                        })

                        total_chunks += 1

                        if len(vectors) >= BATCH_SIZE:
                            index.upsert(vectors)
                            vectors = []

                        time.sleep(EMBED_DELAY)

        if vectors:
            index.upsert(vectors)

        shutil.rmtree(tmp)

        return {"status": "success", "chunks": total_chunks, "logs": logs}

    except Exception as e:
        return {"status": "error", "error": str(e), "logs": logs}


# ---------------- EXPLAIN (RAG) ----------------

@app.post("/api/explain")
def explain(req: ExplainRequest):
    try:
        query_vec = gemini_embed(req.query)

        results = index.query(
            vector=query_vec,
            top_k=5,
            include_metadata=True
        )

        context = "\n\n".join(
            match["metadata"]["text"] for match in results["matches"]
        )

        prompt = f"""
You are an architectural AI assistant.

Code Context:
{context}

User Question:
{req.query}

Explain with architectural insights and system-wide impact.
"""

        answer = gemini_generate(prompt)

        return {"answer": answer}

    except Exception as e:
        return {"error": str(e)}
