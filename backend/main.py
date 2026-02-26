# backend/main.py
import os
import io
import re
import time
import json
import uuid
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

# Try to import pinecone module (most common) and support variations defensively
try:
    import pinecone as pinecone_module  # type: ignore
    PINECONE_MODULE_AVAILABLE = True
except Exception:
    pinecone_module = None
    PINECONE_MODULE_AVAILABLE = False

# ----------------------
# Config / constants
# ----------------------
EMBED_DIM = int(os.getenv("EMBED_DIM", "768"))
DEFAULT_CHUNK_SIZE = int(os.getenv("DEFAULT_CHUNK_SIZE", "1200"))
DEFAULT_CHUNK_OVERLAP = int(os.getenv("DEFAULT_CHUNK_OVERLAP", "200"))
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "deveasy-index")
GEMINI_EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "text-embedding-004")
GEMINI_GEN_MODEL = os.getenv("GEMINI_GEN_MODEL", "gemini-1.5-flash")
GEMINI_EMBED_URL = os.getenv("GEMINI_EMBED_URL", "https://api.generativemodels.example/v1/embeddings")
GEMINI_GEN_URL = os.getenv("GEMINI_GEN_URL", "https://api.generativemodels.example/v1/generate")
GITHUB_USER_AGENT = os.getenv("GITHUB_USER_AGENT", "DevEasy-Ingest-Agent/1.0")

# Secrets (must be set in your deployment environment)
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")  # optional, helpful for rate limits

ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("deveasy-backend")

# FastAPI app
app = FastAPI(title="DevEasy Backend")

# CORS: don't use wildcard '*' with credentials
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


# ----------------------
# Pydantic request models
# ----------------------
class IngestRequest(BaseModel):
    repo_url: str
    allowed_exts: Optional[List[str]] = None
    chunk_size: Optional[int] = DEFAULT_CHUNK_SIZE
    chunk_overlap: Optional[int] = DEFAULT_CHUNK_OVERLAP
    index_name: Optional[str] = PINECONE_INDEX_NAME


class ExplainRequest(BaseModel):
    query: str
    index_name: Optional[str] = PINECONE_INDEX_NAME
    repo_filter: Optional[str] = None


class DebugRequest(BaseModel):
    commit_url: str
    index_name: Optional[str] = PINECONE_INDEX_NAME


# ----------------------
# Helper utilities
# ----------------------
def ensure_envs():
    missing = []
    if not PINECONE_API_KEY:
        missing.append("PINECONE_API_KEY")
    if not GEMINI_API_KEY:
        missing.append("GEMINI_API_KEY")
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")


def append_log(logs: List[str], msg: str):
    logs.append(msg)
    logger.info(msg)


def parse_github_url(url: str) -> Tuple[str, str]:
    url = url.strip()
    git_ssh = re.match(r"git@github\.com:(?P<owner>[^/]+)/(?P<repo>[^/.]+)(?:\.git)?", url)
    if git_ssh:
        return git_ssh.group("owner"), git_ssh.group("repo")
    m = re.match(r"https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)(?:/.*)?", url)
    if m:
        repo = m.group("repo")
        repo = repo[:-4] if repo.endswith(".git") else repo
        return m.group("owner"), repo
    raise ValueError("Unsupported GitHub URL format: " + url)


def download_repo_zip(owner: str, repo: str, dest_path: str, logs: List[str]) -> str:
    headers = {"User-Agent": GITHUB_USER_AGENT}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    zip_url = f"https://api.github.com/repos/{owner}/{repo}/zipball"
    append_log(logs, f"Downloading repo zip from {zip_url}")
    r = requests.get(zip_url, headers=headers, stream=True, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"Failed to download repo zip: {r.status_code} {r.text[:300]}")
    out_file = os.path.join(dest_path, f"{owner}-{repo}.zip")
    with open(out_file, "wb") as fh:
        for chunk in r.iter_content(chunk_size=8192):
            if chunk:
                fh.write(chunk)
    append_log(logs, f"Saved zip to {out_file}")
    return out_file


def extract_code_files(zip_path: str, allowed_exts: Optional[List[str]], logs: List[str]) -> List[Tuple[str, str]]:
    allowed_exts = allowed_exts or [
        ".py",
        ".js",
        ".ts",
        ".java",
        ".cpp",
        ".c",
        ".h",
        ".go",
        ".rs",
        ".md",
        ".json",
        ".yaml",
        ".yml",
        ".sh",
        ".html",
        ".css",
    ]
    files: List[Tuple[str, str]] = []
    append_log(logs, f"Extracting files with allowed extensions: {allowed_exts}")
    with zipfile.ZipFile(zip_path, "r") as z:
        for info in z.infolist():
            name = info.filename
            if name.endswith("/"):
                continue
            parts = name.split("/", 1)
            path = parts[1] if len(parts) > 1 else parts[0]
            _, ext = os.path.splitext(path)
            if ext.lower() in allowed_exts:
                try:
                    raw = z.read(info).decode(errors="replace")
                except Exception:
                    raw = z.read(info).decode("utf-8", errors="replace")
                files.append((path, raw))
    append_log(logs, f"Extracted {len(files)} code files from zip")
    return files


def _safe_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


# ----------------------
# Gemini helpers (REST)
# ----------------------
def gemini_embed_texts(texts: List[str], logs: List[str]) -> List[List[float]]:
    if not texts:
        return []
    headers = {"Authorization": f"Bearer {GEMINI_API_KEY}", "Content-Type": "application/json"}
    payload = {"model": GEMINI_EMBED_MODEL, "input": texts}
    append_log(logs, f"Calling Gemini embed endpoint for {len(texts)} items")
    resp = requests.post(GEMINI_EMBED_URL, headers=headers, json=payload, timeout=60)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini embedding returned {resp.status_code}: {resp.text[:800]}")
    ctype = resp.headers.get("Content-Type", "")
    if "application/json" not in ctype:
        raise RuntimeError(f"Gemini embedding returned non-JSON response: {resp.text[:800]}")
    data = resp.json()

    vectors: List[List[float]] = []
    # defensive parsing for several shapes
    if isinstance(data, dict) and "embeddings" in data:
        for e in data["embeddings"]:
            if isinstance(e, dict) and "values" in e:
                vectors.append(e["values"])
            elif isinstance(e, list):
                vectors.append(e)
    elif isinstance(data, dict) and "data" in data:
        for item in data["data"]:
            if "embedding" in item:
                vectors.append(item["embedding"])
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, list):
                vectors.append(item)

    if not vectors:
        raise RuntimeError(f"Could not parse embedding response from Gemini: {json.dumps(data)[:800]}")

    normalized: List[List[float]] = []
    for v in vectors:
        if len(v) != EMBED_DIM:
            append_log(logs, f"Warning: embedding length {len(v)} != expected {EMBED_DIM}, adjusting")
            if len(v) > EMBED_DIM:
                v = v[:EMBED_DIM]
            else:
                v = v + [0.0] * (EMBED_DIM - len(v))
        normalized.append(v)
    return normalized


def gemini_generate(prompt: str, logs: List[str], temperature: float = 0.1, max_output_tokens: int = 1024) -> str:
    headers = {"Authorization": f"Bearer {GEMINI_API_KEY}", "Content-Type": "application/json"}
    payload = {"model": GEMINI_GEN_MODEL, "prompt": prompt, "temperature": float(temperature), "max_output_tokens": int(max_output_tokens)}
    append_log(logs, "Calling Gemini generate endpoint")
    resp = requests.post(GEMINI_GEN_URL, headers=headers, json=payload, timeout=90)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini generate returned {resp.status_code}: {resp.text[:800]}")
    ctype = resp.headers.get("Content-Type", "")
    if "application/json" not in ctype:
        raise RuntimeError(f"Gemini generate returned non-JSON: {resp.text[:800]}")
    data = resp.json()

    # try common shapes
    if isinstance(data, dict):
        for k in ("output", "generated_text", "text", "result"):
            v = data.get(k)
            if isinstance(v, str):
                return v
        if "choices" in data and isinstance(data["choices"], list) and data["choices"]:
            ch = data["choices"][0]
            if isinstance(ch, dict):
                return ch.get("text") or ch.get("message") or json.dumps(ch)
        if "candidates" in data and isinstance(data["candidates"], list) and data["candidates"]:
            cand = data["candidates"][0]
            if isinstance(cand, dict):
                return cand.get("content") or cand.get("text") or json.dumps(cand)
    return json.dumps(data)


# ----------------------
# Pinecone helpers
# ----------------------
def create_pinecone_client(logs: List[str]):
    append_log(logs, "Initializing Pinecone client")
    if PINECONE_MODULE_AVAILABLE:
        try:
            pinecone_module.init(api_key=PINECONE_API_KEY)
            append_log(logs, "Using pinecone module-style client")
            return pinecone_module
        except Exception as e:
            append_log(logs, f"Pinecone module init failed: {e}")
            raise RuntimeError(f"Pinecone init failed: {e}")
    raise RuntimeError("Pinecone client library not available; install 'pinecone-client' or 'pinecone' package")


def get_or_create_index(client, index_name: str, dimension: int, logs: List[str]):
    append_log(logs, f"Ensuring index '{index_name}' exists (dim={dimension})")
    existing = []
    try:
        resp = client.list_indexes()
        if isinstance(resp, dict):
            existing = resp.get("names", []) or resp.get("indexes", []) or []
        elif isinstance(resp, list):
            existing = resp
        else:
            existing = list(resp)
    except Exception as e:
        append_log(logs, f"Warning: list_indexes failed: {e}")
        existing = []

    if index_name in existing:
        append_log(logs, f"Index {index_name} exists")
        try:
            return client.Index(index_name)
        except Exception:
            try:
                return client.index(index_name)
            except Exception:
                return client

    append_log(logs, f"Creating index {index_name}")
    try:
        client.create_index(name=index_name, dimension=dimension)
    except Exception:
        try:
            client.create(name=index_name, dimension=dimension)
        except Exception as e:
            append_log(logs, f"Index creation warning: {e}")

    try:
        return client.Index(index_name)
    except Exception:
        try:
            return client.index(index_name)
        except Exception:
            return client


# ----------------------
# Endpoints
# ----------------------
@app.get("/health")
def health():
    return {"status": "ok", "service": "deveasy-backend", "time": int(time.time())}


@app.post("/api/ingest")
def ingest(req: IngestRequest):
    logs: List[str] = []
    try:
        ensure_envs()
    except Exception as e:
        logger.exception("Missing envs")
        raise HTTPException(status_code=500, detail=str(e))

    append_log(logs, f"Starting ingestion for {req.repo_url}")
    tmpdir = tempfile.mkdtemp(prefix="deveasy-ingest-")
    try:
        try:
            owner, repo = parse_github_url(req.repo_url)
            append_log(logs, f"Parsed GitHub URL -> owner: {owner}, repo: {repo}")
        except Exception as e:
            append_log(logs, f"Failed to parse GitHub URL: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid GitHub URL: {e}")

        try:
            zip_path = download_repo_zip(owner, repo, tmpdir, logs)
        except Exception as e:
            append_log(logs, f"Failed to download zip: {e}")
            raise HTTPException(status_code=500, detail=f"Download failed: {e}")

        files = extract_code_files(zip_path, req.allowed_exts, logs)
        if not files:
            append_log(logs, "No files matched the allowed extensions")
            return {"status": "success", "logs": logs, "chunks_ingested": 0}

        splitter = RecursiveCharacterTextSplitter(chunk_size=req.chunk_size, chunk_overlap=req.chunk_overlap)
        all_chunks: List[Dict[str, Any]] = []
        for path, content in files:
            try:
                parts = splitter.split_text(content)
            except Exception:
                chunk_size = req.chunk_size or DEFAULT_CHUNK_SIZE
                parts = [content[i:i + chunk_size] for i in range(0, len(content), chunk_size - (req.chunk_overlap or DEFAULT_CHUNK_OVERLAP))]
            for idx, chunk in enumerate(parts):
                chunk_id = _safe_hash(path + ":" + str(idx))
                all_chunks.append({
                    "id": f"{repo}-{chunk_id}",
                    "text": chunk,
                    "path": path,
                    "repo": repo,
                })
        append_log(logs, f"Created {len(all_chunks)} chunks from {len(files)} files")

        pinecone_client = create_pinecone_client(logs)
        index_handle = get_or_create_index(pinecone_client, req.index_name, EMBED_DIM, logs)

        BATCH = 8
        total_ingested = 0
        for i in range(0, len(all_chunks), BATCH):
            batch = all_chunks[i:i + BATCH]
            texts = [c["text"] for c in batch]
            try:
                vectors = gemini_embed_texts(texts, logs)
            except Exception as e:
                append_log(logs, f"Embedding failed for batch starting at {i}: {e}")
                raise HTTPException(status_code=500, detail=f"Embedding failure: {e}")

            to_upsert = []
            for c, v in zip(batch, vectors):
                metadata = {"text": c["text"], "path": c["path"], "repo": c["repo"]}
                to_upsert.append({"id": c["id"], "values": v, "metadata": metadata})

            try:
                if hasattr(index_handle, "upsert"):
                    index_handle.upsert(vectors=to_upsert)
                elif hasattr(pinecone_client, "upsert"):
                    pinecone_client.upsert(index=req.index_name, vectors=to_upsert)
                else:
                    index_handle.upsert(vectors=to_upsert)
                total_ingested += len(to_upsert)
                append_log(logs, f"Upserted {len(to_upsert)} vectors (total {total_ingested})")
            except Exception as e:
                append_log(logs, f"Pinecone upsert failed: {e}")
                append_log(logs, f"First vector snippet: {str(to_upsert[0])[:400]}")
                raise HTTPException(status_code=500, detail=f"Pinecone upsert failed: {e}")

            time.sleep(0.2)

        append_log(logs, f"Ingestion complete — total chunks ingested: {total_ingested}")
        return {"status": "success", "logs": logs, "chunks_ingested": total_ingested}
    except HTTPException:
        raise
    except Exception as exc:
        tb = traceback.format_exc()
        append_log(logs, f"Unhandled error: {exc}\n{tb}")
        raise HTTPException(status_code=500, detail={"error": str(exc), "trace": tb, "logs": logs})
    finally:
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass


@app.post("/api/explain")
def explain(req: ExplainRequest):
    logs: List[str] = []
    try:
        ensure_envs()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    append_log(logs, f"Explain requested for query: {req.query}")
    try:
        pinecone_client = create_pinecone_client(logs)
        index_handle = get_or_create_index(pinecone_client, req.index_name, EMBED_DIM, logs)

        query_vector = gemini_embed_texts([req.query], logs)[0]

        append_log(logs, "Querying Pinecone for relevant code chunks")
        top_k = 5
        results = None
        try:
            if hasattr(index_handle, "query"):
                results = index_handle.query(vector=query_vector, top_k=top_k, include_metadata=True)
            elif hasattr(pinecone_client, "query"):
                results = pinecone_client.query(index=req.index_name, vector=query_vector, top_k=top_k, include_metadata=True)
            else:
                results = index_handle.query(vector=query_vector, top_k=top_k, include_metadata=True)
        except Exception as e:
            append_log(logs, f"Pinecone query failed: {e}")
            raise HTTPException(status_code=500, detail=f"Pinecone query failed: {e}")

        hits: List[Dict[str, Any]] = []
        if isinstance(results, dict):
            matches = results.get("matches") or []
            for m in matches:
                metadata = m.get("metadata") or {}
                hits.append({"id": m.get("id"), "score": m.get("score"), "metadata": metadata})
        else:
            try:
                matches = getattr(results, "matches", results) or []
                for m in matches:
                    if isinstance(m, dict):
                        metadata = m.get("metadata", {})
                        hits.append({"id": m.get("id"), "score": m.get("score"), "metadata": metadata})
            except Exception:
                pass

        sources = []
        context_parts = []
        for h in hits[:top_k]:
            md = h.get("metadata", {})
            text = md.get("text") or ""
            path = md.get("path") or md.get("file") or "unknown"
            repo = md.get("repo") or ""
            sources.append({"path": path, "repo": repo})
            snippet = text[:1500]
            context_parts.append(f"--- FILE: {path} ---\n{snippet}\n")

        rag_prompt = (
            "You are an expert code reviewer. Use the following context from repository files to answer the user's question.\n\n"
            f"CONTEXT:\n{''.join(context_parts)}\n\n"
            f"USER QUESTION: {req.query}\n\n"
            "Please produce a complete answer in Markdown that includes:\n"
            "1. A direct, concise answer.\n"
            "2. Which files or code areas were used as source (list file paths).\n"
            "3. Possible architecture/system-wide impacts.\n"
            "4. Warnings and testing suggestions.\n"
        )
        answer = gemini_generate(rag_prompt, logs, temperature=0.05, max_output_tokens=900)
        return {"answer": answer, "sources": sources, "logs": logs}
    except HTTPException:
        raise
    except Exception as exc:
        tb = traceback.format_exc()
        append_log(logs, f"Unhandled error in explain: {exc}\n{tb}")
        raise HTTPException(status_code=500, detail={"error": str(exc), "trace": tb, "logs": logs})


@app.post("/api/debug")
def debug(req: DebugRequest):
    logs: List[str] = []
    try:
        ensure_envs()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    append_log(logs, f"Debug requested for commit: {req.commit_url}")
    try:
        m = re.match(r"https?://github\.com/([^/]+)/([^/]+)/commit/([0-9a-fA-F]+)", req.commit_url)
        if not m:
            raise HTTPException(status_code=400, detail="Invalid commit URL format")
        owner, repo, sha = m.group(1), m.group(2), m.group(3)
        append_log(logs, f"Parsed commit -> owner:{owner} repo:{repo} sha:{sha}")

        headers = {"User-Agent": GITHUB_USER_AGENT, "Accept": "application/vnd.github.v3+json"}
        if GITHUB_TOKEN:
            headers["Authorization"] = f"token {GITHUB_TOKEN}"
        commit_api = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
        append_log(logs, f"Fetching commit from {commit_api}")
        r = requests.get(commit_api, headers=headers, timeout=30)
        if r.status_code != 200:
            raise HTTPException(status_code=500, detail=f"GitHub API error: {r.status_code} {r.text[:200]}")
        commit_json = r.json()
        files = commit_json.get("files", [])
        changed_files = []
        unified_diff_parts = []
        for f in files:
            path = f.get("filename")
            patch = f.get("patch") or ""
            changed_files.append(path)
            if patch:
                unified_diff_parts.append(f"--- {path} ---\n{patch}\n")

        pinecone_client = create_pinecone_client(logs)
        index_handle = get_or_create_index(pinecone_client, req.index_name, EMBED_DIM, logs)

        def query_file_context(file_path: str) -> List[str]:
            v = gemini_embed_texts([file_path], logs)[0]
            try:
                if hasattr(index_handle, "query"):
                    res = index_handle.query(vector=v, top_k=8, include_metadata=True)
                else:
                    res = pinecone_client.query(index=req.index_name, vector=v, top_k=8, include_metadata=True)
            except Exception:
                return []
            hits_local = []
            if isinstance(res, dict):
                for m in res.get("matches", [])[:8]:
                    md = m.get("metadata", {})
                    hits_local.append(md.get("path") or "unknown")
            else:
                matches = getattr(res, "matches", res) or []
                for m in matches:
                    if isinstance(m, dict):
                        hits_local.append(m.get("metadata", {}).get("path", "unknown"))
            return hits_local

        blast_radius = set()
        for ch in changed_files:
            append_log(logs, f"Analyzing blast radius for: {ch}")
            deps = query_file_context(ch)
            for d in deps:
                blast_radius.add(d)
            time.sleep(0.1)

        blast_list = sorted(list(blast_radius))
        append_log(logs, f"Blast radius files: {blast_list}")

        pr_prompt = (
            f"You're drafting a PR summary for changes in commit {sha} of repo {owner}/{repo}.\n\n"
            f"Changed files:\n{json.dumps(changed_files, indent=2)}\n\n"
            f"Potentially impacted files (blast radius):\n{json.dumps(blast_list, indent=2)}\n\n"
            "Please produce a markdown PR summary including:\n"
            "- Short summary\n"
            "- Changed areas (bulleted)\n"
            "- Potential risks / blast radius\n"
            "- Recommended tests / checklist\n"
            "- Suggested labels (e.g., bug, refactor, docs)\n"
        )
        pr_summary = gemini_generate(pr_prompt, logs, temperature=0.05, max_output_tokens=600)
        diff_text = "\n".join(unified_diff_parts) if unified_diff_parts else ""
        return {"diff": diff_text, "blast_radius": blast_list, "pr_summary": pr_summary, "logs": logs}
    except HTTPException:
        raise
    except Exception as exc:
        tb = traceback.format_exc()
        append_log(logs, f"Unhandled error in debug: {exc}\n{tb}")
        raise HTTPException(status_code=500, detail={"error": str(exc), "trace": tb, "logs": logs})


@app.post("/api/architecture")
def architecture():
    nodes = [
        {"id": "client", "label": "Client", "description": "Frontend client (browser)", "x": 0, "y": 0, "color": "#6EE7B7"},
        {"id": "backend", "label": "Backend", "description": "FastAPI backend (this service)", "x": 200, "y": 0, "color": "#60A5FA"},
        {"id": "gemini", "label": "Gemini", "description": "Google Gemini LLM & embeddings", "x": 400, "y": -80, "color": "#F97316"},
        {"id": "pinecone", "label": "Pinecone", "description": "Vector DB", "x": 400, "y": 80, "color": "#FB7185"},
        {"id": "github", "label": "GitHub", "description": "Source repositories", "x": -200, "y": 80, "color": "#A78BFA"},
        {"id": "splitter", "label": "Splitter", "description": "LangChain chunker", "x": 200, "y": -120, "color": "#FDE68A"},
    ]
    edges = [
        {"from": "client", "to": "backend", "label": "REST"},
        {"from": "backend", "to": "github", "label": "download/ingest"},
        {"from": "backend", "to": "splitter", "label": "chunk"},
        {"from": "splitter", "to": "pinecone", "label": "upsert embeddings"},
        {"from": "backend", "to": "gemini", "label": "embed / generate"},
        {"from": "pinecone", "to": "backend", "label": "RAG retrieval"},
    ]
    return {"nodes": nodes, "edges": edges}


if __name__ == "__main__":
    import uvicorn
    try:
        ensure_envs()
    except Exception as e:
        logger.warning(f"Startup env check warning: {e}")
    uvicorn.run("backend.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
