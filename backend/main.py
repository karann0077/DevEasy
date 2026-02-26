import os
import io
import re
import time
import zipfile
import requests
import traceback
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pinecone import Pinecone, ServerlessSpec
from langchain.text_splitter import RecursiveCharacterTextSplitter

# Try to support both pinecone SDK shapes (wrapper vs module import)
try:
    # Newer-style typed client (sometimes provided as class)
    from pinecone import Pinecone  # type: ignore
    PINECONE_CLIENT_CLASS = "pinecone_class"
except Exception:
    import pinecone as pinecone_module  # type: ignore
    PINECONE_CLIENT_CLASS = "pinecone_module"  # type: ignore

# Constants
EMBED_DIM = 768
DEFAULT_CHUNK_SIZE = 1200
DEFAULT_CHUNK_OVERLAP = 200
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "deveasy-index")
GEMINI_EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "text-embedding-004")
GEMINI_GEN_MODEL = os.getenv("GEMINI_GEN_MODEL", "gemini-1.5-flash")
GITHUB_USER_AGENT = os.getenv("GITHUB_USER_AGENT", "DevEasy-Ingest-Agent/1.0")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")

# Gemini REST endpoints (placeholders — replace with current Google endpoint if/when needed)
GEMINI_EMBED_URL = os.getenv("GEMINI_EMBED_URL", "https://api.generativemodels.example/v1/embeddings")
GEMINI_GEN_URL = os.getenv("GEMINI_GEN_URL", "https://api.generativemodels.example/v1/generate")

# Environment keys
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")  # optional for higher GitHub rate limits

# Set up basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("deveasy-backend")

app = FastAPI(title="DevEasy Backend")

# CORS: don't use allow_credentials=True with allow_origins=["*"]
if ALLOWED_ORIGIN == "*" or not ALLOWED_ORIGIN:
    # Dev-friendly, but disallow credentials when wildcard is used
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
    allowed_exts: Optional[List[str]] = None  # e.g. [".py", ".js"]
    chunk_size: Optional[int] = DEFAULT_CHUNK_SIZE
    chunk_overlap: Optional[int] = DEFAULT_CHUNK_OVERLAP
    index_name: Optional[str] = PINECONE_INDEX_NAME


class ExplainRequest(BaseModel):
    query: str
    index_name: Optional[str] = PINECONE_INDEX_NAME
    repo_filter: Optional[str] = None  # repo name to filter results


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
    """
    Parse GitHub repo URL and return (owner, repo_name)
    Accepts forms:
      - https://github.com/owner/repo
      - https://github.com/owner/repo.git
      - git@github.com:owner/repo.git
    """
    url = url.strip()
    # Handle git@... style
    git_ssh = re.match(r"git@github\.com:(?P<owner>[^/]+)/(?P<repo>[^/.]+)(?:\.git)?", url)
    if git_ssh:
        return git_ssh.group("owner"), git_ssh.group("repo")
    # Handle https
    m = re.match(r"https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)(?:/.*)?", url)
    if m:
        repo = m.group("repo")
        repo = repo[:-4] if repo.endswith(".git") else repo
        return m.group("owner"), repo
    raise ValueError("Unsupported GitHub URL format: " + url)


def download_repo_zip(owner: str, repo: str, dest_path: str, logs: List[str]) -> str:
    """
    Downloads the repository zipball into dest_path and returns the local path.
    """
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
    """
    Extract code files from the zip and return list of tuples: (normalized_path, contents)
    """
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
            # skip directories
            if name.endswith("/"):
                continue
            # normalize path: drop top-level folder
            parts = name.split("/", 1)
            path = parts[1] if len(parts) > 1 else parts[0]
            _, ext = os.path.splitext(path)
            if ext.lower() in allowed_exts:
                try:
                    raw = z.read(info).decode(errors="replace")
                except Exception:
                    # fallback: read as bytes
                    raw = z.read(info).decode("utf-8", errors="replace")
                files.append((path, raw))
    append_log(logs, f"Extracted {len(files)} code files from zip")
    return files


def _safe_hash(text: str) -> str:
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()
    return h


# ----------------------
# Gemini helpers (REST)
# ----------------------
def gemini_embed_texts(texts: List[str], logs: List[str]) -> List[List[float]]:
    """
    Send texts to Gemini embedding endpoint and return list of embedding vectors.
    Defensive about response shape and length.
    """
    if not texts:
        return []

    headers = {"Authorization": f"Bearer {GEMINI_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": GEMINI_EMBED_MODEL,
        # Use batching at reasonable sizes (Gemini may accept list)
        "input": texts,
    }
    append_log(logs, f"Calling Gemini embed endpoint for {len(texts)} items")
    resp = requests.post(GEMINI_EMBED_URL, headers=headers, json=payload, timeout=60)
    try:
        data = resp.json()
    except Exception:
        raise RuntimeError(f"Non-JSON response from Gemini embedding: {resp.status_code} {resp.text[:400]}")

    # Defensive parsing: try several common keys
    vectors: List[List[float]] = []
    if isinstance(data, dict):
        # Case: data["embedding"]["values"] single or list
        # Or: data["embeddings"] -> list of { "values": [...] } or list of lists
        if "embedding" in data and isinstance(data["embedding"], dict) and "values" in data["embedding"]:
            vectors = [data["embedding"]["values"]]
        elif "embeddings" in data and isinstance(data["embeddings"], list):
            # embeddings may be list of dicts or list of lists
            for e in data["embeddings"]:
                if isinstance(e, dict) and "values" in e:
                    vectors.append(e["values"])
                elif isinstance(e, list):
                    vectors.append(e)
        elif "data" in data and isinstance(data["data"], list):
            # OpenAI-style: data -> [ {embedding: [...]} ]
            for item in data["data"]:
                if isinstance(item, dict):
                    if "embedding" in item:
                        vectors.append(item["embedding"])
                    elif "values" in item:
                        vectors.append(item["values"])
        else:
            # last attempt: if top-level is a list
            if isinstance(data.get("result"), list):
                for item in data["result"]:
                    if isinstance(item, list):
                        vectors.append(item)
    elif isinstance(data, list):
        # direct list-of-vectors
        for item in data:
            if isinstance(item, list):
                vectors.append(item)

    if not vectors:
        raise RuntimeError(f"Could not parse embedding response from Gemini: {json.dumps(data)[:800]}")

    # Validate dims and normalize (pad/truncate if necessary)
    normalized: List[List[float]] = []
    for v in vectors:
        if len(v) != EMBED_DIM:
            append_log(logs, f"Warning: embedding length {len(v)} != expected {EMBED_DIM}, adjusting")
            if len(v) > EMBED_DIM:
                v = v[:EMBED_DIM]
            else:
                # pad with zeros
                v = v + [0.0] * (EMBED_DIM - len(v))
        normalized.append(v)
    return normalized


def gemini_generate(prompt: str, logs: List[str], temperature: float = 0.1, max_output_tokens: int = 1024) -> str:
    headers = {"Authorization": f"Bearer {GEMINI_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": GEMINI_GEN_MODEL,
        "prompt": prompt,
        "temperature": float(temperature),
        "max_output_tokens": int(max_output_tokens),
    }
    append_log(logs, "Calling Gemini generate endpoint")
    resp = requests.post(GEMINI_GEN_URL, headers=headers, json=payload, timeout=60)
    try:
        data = resp.json()
    except Exception:
        raise RuntimeError(f"Non-JSON response from Gemini generate: {resp.status_code} {resp.text[:400]}")

    # Defensive: try common fields (e.g., 'output', 'generated_text', 'candidates', 'content')
    text = None
    if isinstance(data, dict):
        # Common shapes
        if "output" in data and isinstance(data["output"], str):
            text = data["output"]
        elif "generated_text" in data:
            text = data["generated_text"]
        elif "candidates" in data and isinstance(data["candidates"], list) and data["candidates"]:
            # e.g. {"candidates": [{"content": "..."}]}
            candidate = data["candidates"][0]
            if isinstance(candidate, dict):
                text = candidate.get("content") or candidate.get("text") or candidate.get("output")
        elif "choices" in data and isinstance(data["choices"], list):
            ch = data["choices"][0]
            # openai-style
            if isinstance(ch, dict) and "text" in ch:
                text = ch["text"]
        elif "result" in data and isinstance(data["result"], dict):
            # some endpoints put string in result.output_text or similar
            r = data["result"]
            text = r.get("output_text") or r.get("content") or r.get("text")
    if text is None:
        # Fallback to pretty-print of response (safe)
        text = json.dumps(data)
    append_log(logs, "Gemini generation complete")
    return text


# ----------------------
# Pinecone helpers
# ----------------------
def create_pinecone_client(logs: List[str]):
    append_log(logs, "Initializing Pinecone client")
    if PINECONE_CLIENT_CLASS == "pinecone_class":
        # If environment provides class-style client
        try:
            client = Pinecone(api_key=PINECONE_API_KEY)
            append_log(logs, "Using Pinecone class-style client")
            return client
        except Exception as e:
            append_log(logs, f"Pinecone class init failed: {e}")
            # fallback to module
    try:
        # try module style (most common)
        import pinecone as pinecone_module  # type: ignore
        pinecone_module.init(api_key=PINECONE_API_KEY)
        append_log(logs, "Using pinecone module-style client")
        return pinecone_module
    except Exception as e:
        raise RuntimeError(f"Failed to initialize Pinecone client: {e}")


def get_or_create_index(client, index_name: str, dimension: int, logs: List[str]):
    append_log(logs, f"Ensuring index '{index_name}' exists (dim={dimension})")
    # client.list_indexes() can be list or dict depending on SDK
    existing = []
    try:
        resp = client.list_indexes()
        if isinstance(resp, dict):
            existing = resp.get("names", []) or resp.get("indexes", []) or []
        elif isinstance(resp, list):
            existing = resp
        else:
            # try to coerce to list
            existing = list(resp)
    except Exception as e:
        append_log(logs, f"Warning: list_indexes failed: {e}")
        existing = []

    if index_name in existing:
        append_log(logs, f"Index {index_name} already exists")
        # return index handle/object
        try:
            if hasattr(client, "Index"):
                return client.Index(index_name)
            elif hasattr(client, "index"):
                return client.index(index_name)
            else:
                return client  # best-effort
        except Exception:
            return client

    # create index (SDKs differ)
    append_log(logs, f"Creating index {index_name}")
    try:
        # attempt module-style creation
        if hasattr(client, "create_index"):
            client.create_index(name=index_name, dimension=dimension)
        elif hasattr(client, "create"):
            client.create(name=index_name, dimension=dimension)
        else:
            # last resort, try attribute on module
            client.create_index(name=index_name, dimension=dimension)
    except Exception as e:
        append_log(logs, f"Index creation warning: {e}")

    # return index handle
    try:
        if hasattr(client, "Index"):
            return client.Index(index_name)
        elif hasattr(client, "index"):
            return client.index(index_name)
    except Exception:
        pass
    return client


# ----------------------
# Endpoints
# ----------------------
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
        # parse owner/repo
        try:
            owner, repo = parse_github_url(req.repo_url)
            append_log(logs, f"Parsed GitHub URL -> owner: {owner}, repo: {repo}")
        except Exception as e:
            append_log(logs, f"Failed to parse GitHub URL: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid GitHub URL: {e}")

        # download zip
        try:
            zip_path = download_repo_zip(owner, repo, tmpdir, logs)
        except Exception as e:
            append_log(logs, f"Failed to download zip: {e}")
            raise HTTPException(status_code=500, detail=f"Download failed: {e}")

        # extract code files
        files = extract_code_files(zip_path, req.allowed_exts, logs)
        if not files:
            append_log(logs, "No files matched the allowed extensions")
            return {"status": "success", "logs": logs, "chunks_ingested": 0}

        # chunk files
        splitter = RecursiveCharacterTextSplitter(chunk_size=req.chunk_size, chunk_overlap=req.chunk_overlap)
        all_chunks: List[Dict[str, Any]] = []
        for path, content in files:
            try:
                parts = splitter.split_text(content)
            except Exception:
                # fallback simple splitting by length
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

        # create/initialize pinecone
        pinecone_client = create_pinecone_client(logs)
        index_handle = get_or_create_index(pinecone_client, req.index_name, EMBED_DIM, logs)

        # embed and upsert in batches
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

            # perform upsert (defensive)
            try:
                if hasattr(index_handle, "upsert"):
                    # many pinecone SDKs accept list of dict {"id","values","metadata"}
                    index_handle.upsert(vectors=to_upsert)
                elif hasattr(pinecone_client, "upsert"):
                    pinecone_client.upsert(index=req.index_name, vectors=to_upsert)
                else:
                    # best-effort: try module index interface
                    index_handle.upsert(vectors=to_upsert)
                total_ingested += len(to_upsert)
                append_log(logs, f"Upserted {len(to_upsert)} vectors (total {total_ingested})")
            except Exception as e:
                append_log(logs, f"Pinecone upsert failed: {e}")
                # attempt to log the first vector to inspect shape
                append_log(logs, f"First vector snippet: {str(to_upsert[0])[:400]}")
                raise HTTPException(status_code=500, detail=f"Pinecone upsert failed: {e}")

            # polite pause to avoid rate limits
            time.sleep(0.2)

        append_log(logs, f"Ingestion complete — total chunks ingested: {total_ingested}")
        return {"status": "success", "logs": logs, "chunks_ingested": total_ingested}
    except HTTPException:
        # rethrow
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

        # embed query
        query_vector = gemini_embed_texts([req.query], logs)[0]

        # pinecone query (defensive)
        append_log(logs, "Querying Pinecone for relevant code chunks")
        top_k = 5
        results = None
        try:
            if hasattr(index_handle, "query"):
                # common signature
                results = index_handle.query(vector=query_vector, top_k=top_k, include_metadata=True)
            elif hasattr(pinecone_client, "query"):
                results = pinecone_client.query(index=req.index_name, vector=query_vector, top_k=top_k, include_metadata=True)
            else:
                results = index_handle.query(vector=query_vector, top_k=top_k, include_metadata=True)
        except Exception as e:
            append_log(logs, f"Pinecone query failed: {e}")
            raise HTTPException(status_code=500, detail=f"Pinecone query failed: {e}")

        # parse result to extract metadata/text
        hits: List[Dict[str, Any]] = []
        if isinstance(results, dict):
            # e.g., {"matches": [...]}
            matches = results.get("matches") or results.get("matches", [])
            for m in matches:
                metadata = m.get("metadata") or {}
                hits.append({"id": m.get("id"), "score": m.get("score"), "metadata": metadata})
        else:
            # attempt to inspect attribute
            try:
                matches = getattr(results, "matches", None) or results
                for m in matches:
                    if isinstance(m, dict):
                        metadata = m.get("metadata", {})
                        hits.append({"id": m.get("id"), "score": m.get("score"), "metadata": metadata})
            except Exception:
                pass

        # build context from hits
        sources = []
        context_parts = []
        for h in hits[:top_k]:
            md = h.get("metadata", {})
            text = md.get("text") or ""
            path = md.get("path") or md.get("file") or "unknown"
            repo = md.get("repo") or ""
            sources.append({"path": path, "repo": repo})
            # keep short snippet
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
            "4. Warnings and testing suggestions.\n            "
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
        # parse commit url: accept https://github.com/{owner}/{repo}/commit/{sha}
        m = re.match(r"https?://github\.com/([^/]+)/([^/]+)/commit/([0-9a-fA-F]+)", req.commit_url)
        if not m:
            raise HTTPException(status_code=400, detail="Invalid commit URL format")
        owner, repo, sha = m.group(1), m.group(2), m.group(3)
        append_log(logs, f"Parsed commit -> owner:{owner} repo:{repo} sha:{sha}")

        # fetch commit details from GitHub
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
        if not files:
            append_log(logs, "No files changed in commit")
        changed_files = []
        unified_diff_parts = []
        for f in files:
            path = f.get("filename")
            patch = f.get("patch") or ""
            changed_files.append(path)
            if patch:
                unified_diff_parts.append(f"--- {path} ---\n{patch}\n")

        # For each changed file, query pinecone to find dependent chunks
        pinecone_client = create_pinecone_client(logs)
        index_handle = get_or_create_index(pinecone_client, req.index_name, EMBED_DIM, logs)

        def query_file_context(file_path: str) -> List[str]:
            # Embed file path as a query or short description
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
                matches = getattr(res, "matches", res)
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

        # Generate PR summary using Gemini
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
    # Hardcoded architecture map — you can later replace with real generated nodes/edges
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


# Root health check
@app.get("/")
def root():
    return {"status": "ok", "service": "DevEasy backend"}


# If run directly
if __name__ == "__main__":
    import uvicorn

    # Do not crash quietly if envs are missing
    try:
        ensure_envs()
    except Exception as e:
        logger.warning(f"Startup env check failed: {e}")

    uvicorn.run("backend.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
