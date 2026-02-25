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

# ─────────────────────────────────────────────
# BYPASS SYSTEM PROXIES (Critical for local dev)
# ─────────────────────────────────────────────
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)
os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)

# ─────────────────────────────────────────────
# ENVIRONMENT VARIABLES
# ─────────────────────────────────────────────
GEMINI_API_KEY   = os.getenv("GEMINI_API_KEY", "")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
PINECONE_INDEX   = os.getenv("PINECONE_INDEX_NAME", "innovate-bharat")

GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "text-embedding-004:embedContent"
)
GEMINI_GEN_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-1.5-flash:generateContent"
)

VALID_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".cpp", ".c", ".h",
    ".java", ".go", ".rs", ".md", ".json", ".yaml", ".yml",
    ".html", ".css", ".scss", ".sql", ".sh", ".env.example",
}

EMBED_DIM = 768

# ─────────────────────────────────────────────
# PINECONE INIT
# ─────────────────────────────────────────────
pc = Pinecone(api_key=PINECONE_API_KEY)

def get_or_create_index():
    existing = [i.name for i in pc.list_indexes()]
    if PINECONE_INDEX not in existing:
        pc.create_index(
            name=PINECONE_INDEX,
            dimension=EMBED_DIM,
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
        # Wait until ready
        while not pc.describe_index(PINECONE_INDEX).status["ready"]:
            time.sleep(1)
    return pc.Index(PINECONE_INDEX)

# ─────────────────────────────────────────────
# FASTAPI APP
# ─────────────────────────────────────────────
app = FastAPI(title="InnovateBHARAT AI Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# PYDANTIC SCHEMAS
# ─────────────────────────────────────────────
class IngestRequest(BaseModel):
    repo_url: str

class IngestResponse(BaseModel):
    status: str
    logs: List[str]
    chunks_ingested: int

class ExplainRequest(BaseModel):
    query: str
    repo_name: Optional[str] = None

class ExplainResponse(BaseModel):
    answer: str
    sources: List[str]

class DebugRequest(BaseModel):
    commit_url: str

class DebugResponse(BaseModel):
    blast_radius: List[str]
    pr_summary: str
    diff: str

class ArchitectureRequest(BaseModel):
    repo_name: Optional[str] = None

class ArchitectureNode(BaseModel):
    id: str
    label: str
    description: str
    x: float
    y: float
    color: str

class ArchitectureEdge(BaseModel):
    from_id: str
    to_id: str
    label: str

class ArchitectureResponse(BaseModel):
    nodes: List[ArchitectureNode]
    edges: List[ArchitectureEdge]

# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────
def gemini_embed(text: str) -> List[float]:
    """Generate a 768-dim embedding via Gemini REST API."""
    payload = {
        "model": "models/text-embedding-004",
        "content": {"parts": [{"text": text}]},
        "outputDimensionality": EMBED_DIM,
    }
    resp = requests.post(
        GEMINI_EMBED_URL,
        params={"key": GEMINI_API_KEY},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    vector = resp.json()["embedding"]["values"]
    return vector[:EMBED_DIM]


def gemini_generate(prompt: str) -> str:
    """Generate text via Gemini 1.5 Flash REST API."""
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 2048,
        },
    }
    resp = requests.post(
        GEMINI_GEN_URL,
        params={"key": GEMINI_API_KEY},
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["candidates"][0]["content"]["parts"][0]["text"]


def parse_github_url(repo_url: str):
    """Extract owner and repo name from a GitHub URL."""
    repo_url = repo_url.rstrip("/")
    match = re.match(r"https?://github\.com/([^/]+)/([^/]+)", repo_url)
    if not match:
        raise ValueError(f"Invalid GitHub URL: {repo_url}")
    owner, repo = match.group(1), match.group(2)
    repo = repo.replace(".git", "")
    return owner, repo


def download_repo_zip(owner: str, repo: str) -> bytes:
    """Download repository as a zip via GitHub's zipball API."""
    url = f"https://api.github.com/repos/{owner}/{repo}/zipball"
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "InnovateBHARAT-AI-Engine/1.0",
    }
    resp = requests.get(url, headers=headers, timeout=120, allow_redirects=True)
    resp.raise_for_status()
    return resp.content


def extract_code_files(zip_bytes: bytes, repo_name: str):
    """Extract valid code files from zip bytes."""
    files = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for name in zf.namelist():
            ext = os.path.splitext(name)[1].lower()
            if ext not in VALID_EXTENSIONS:
                continue
            try:
                content = zf.read(name).decode("utf-8", errors="ignore")
                if content.strip():
                    # Normalize path: remove top-level dir prefix
                    parts = name.split("/", 1)
                    clean_path = parts[1] if len(parts) > 1 else name
                    files.append({"path": clean_path, "content": content})
            except Exception:
                continue
    return files


# ─────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "InnovateBHARAT AI Engine"}


@app.post("/api/ingest", response_model=IngestResponse)
def ingest_repo(req: IngestRequest):
    logs = []
    chunks_ingested = 0

    try:
        logs.append(f"[1/6] Parsing GitHub URL: {req.repo_url}")
        owner, repo = parse_github_url(req.repo_url)
        repo_name = f"{owner}/{repo}"
        logs.append(f"[2/6] Downloading repository: {repo_name}")

        zip_bytes = download_repo_zip(owner, repo)
        logs.append(f"[3/6] Download complete ({len(zip_bytes) // 1024} KB). Extracting code files...")

        files = extract_code_files(zip_bytes, repo_name)
        logs.append(f"[4/6] Extracted {len(files)} valid code files. Chunking...")

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1200,
            chunk_overlap=200,
        )

        all_chunks = []
        for f in files:
            chunks = splitter.split_text(f["content"])
            for chunk in chunks:
                all_chunks.append({
                    "text": chunk,
                    "file_path": f["path"],
                    "repo_name": repo_name,
                })

        logs.append(f"[5/6] Created {len(all_chunks)} chunks. Generating embeddings (this may take a while)...")

        index = get_or_create_index()
        vectors = []

        for i, chunk in enumerate(all_chunks):
            try:
                embedding = gemini_embed(chunk["text"])
                vectors.append({
                    "id": f"{repo_name.replace('/', '_')}_{i}",
                    "values": embedding,
                    "metadata": {
                        "text": chunk["text"][:1000],
                        "file_path": chunk["file_path"],
                        "repo_name": chunk["repo_name"],
                    },
                })
                time.sleep(0.25)  # Rate limiting
                if (i + 1) % 10 == 0:
                    logs.append(f"    Embedded {i + 1}/{len(all_chunks)} chunks...")
            except Exception as e:
                logs.append(f"    WARNING: Skipped chunk {i}: {str(e)}")
                continue

        # Upsert in batches of 100
        logs.append(f"[6/6] Upserting {len(vectors)} vectors to Pinecone...")
        batch_size = 100
        for start in range(0, len(vectors), batch_size):
            batch = vectors[start : start + batch_size]
            index.upsert(vectors=batch)

        chunks_ingested = len(vectors)
        logs.append(f"✅ Ingestion complete! {chunks_ingested} chunks stored in Pinecone index '{PINECONE_INDEX}'.")

        return IngestResponse(status="success", logs=logs, chunks_ingested=chunks_ingested)

    except Exception as e:
        logs.append(f"❌ ERROR: {str(e)}")
        logs.append(traceback.format_exc())
        raise HTTPException(status_code=500, detail={"logs": logs, "error": str(e)})


@app.post("/api/explain", response_model=ExplainResponse)
def explain_code(req: ExplainRequest):
    try:
        index = get_or_create_index()

        # Embed the query
        query_vector = gemini_embed(req.query)

        # Query Pinecone
        filter_dict = {}
        if req.repo_name:
            filter_dict = {"repo_name": {"$eq": req.repo_name}}

        results = index.query(
            vector=query_vector,
            top_k=5,
            include_metadata=True,
            filter=filter_dict if filter_dict else None,
        )

        if not results.matches:
            return ExplainResponse(
                answer="No relevant code found. Please ingest a repository first.",
                sources=[],
            )

        # Build context
        context_parts = []
        sources = []
        for match in results.matches:
            meta = match.metadata
            context_parts.append(
                f"### File: {meta.get('file_path', 'unknown')}\n```\n{meta.get('text', '')}\n```"
            )
            sources.append(meta.get("file_path", "unknown"))

        context = "\n\n".join(context_parts)

        prompt = f"""You are InnovateBHARAT AI — an expert software architect analyzing a codebase.

RETRIEVED CODEBASE CONTEXT:
{context}

USER QUESTION: {req.query}

Provide a comprehensive, markdown-formatted answer that includes:
1. **Direct Answer**: Explain what the code does based on the retrieved context.
2. **Architecture Impact**: How does this component fit into the overall system?
3. **⚠️ Architectural Warnings**: Identify any potential issues, anti-patterns, or tech debt.
4. **🔗 System-Wide Impacts**: What other parts of the system might be affected by changes here?
5. **💡 Recommendations**: Suggest improvements if applicable.

Be precise, technical, and insightful."""

        answer = gemini_generate(prompt)
        return ExplainResponse(answer=answer, sources=list(set(sources)))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/debug", response_model=DebugResponse)
def debug_commit(req: DebugRequest):
    try:
        # Parse commit URL: https://github.com/owner/repo/commit/SHA
        match = re.match(
            r"https?://github\.com/([^/]+)/([^/]+)/commit/([a-f0-9]+)",
            req.commit_url,
        )
        if not match:
            raise ValueError("Invalid GitHub commit URL. Expected: https://github.com/owner/repo/commit/SHA")

        owner, repo, sha = match.group(1), match.group(2), match.group(3)
        repo_name = f"{owner}/{repo}"

        # Fetch commit diff from GitHub API
        headers = {"Accept": "application/vnd.github.v3.diff"}
        diff_resp = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}",
            headers={"Accept": "application/vnd.github+json"},
            timeout=30,
        )
        diff_resp.raise_for_status()
        commit_data = diff_resp.json()

        # Get the diff
        diff_text_resp = requests.get(
            f"https://github.com/{owner}/{repo}/commit/{sha}.diff",
            timeout=30,
        )
        diff_text = diff_text_resp.text[:5000] if diff_text_resp.ok else "Diff unavailable"

        changed_files = [f["filename"] for f in commit_data.get("files", [])]
        commit_message = commit_data.get("commit", {}).get("message", "No message")

        # Use RAG to find blast radius
        index = get_or_create_index()
        blast_radius = []

        for changed_file in changed_files[:3]:  # Limit to 3 files
            try:
                query = f"What code depends on or imports from {changed_file}?"
                query_vector = gemini_embed(query)
                results = index.query(
                    vector=query_vector,
                    top_k=3,
                    include_metadata=True,
                    filter={"repo_name": {"$eq": repo_name}},
                )
                for match in results.matches:
                    fp = match.metadata.get("file_path", "")
                    if fp and fp not in blast_radius and fp not in changed_files:
                        blast_radius.append(fp)
            except Exception:
                continue

        # Generate PR summary using Gemini
        summary_prompt = f"""You are a senior software engineer reviewing a Git commit.

Commit SHA: {sha}
Repository: {repo_name}
Commit Message: {commit_message}

Changed Files:
{chr(10).join(f'- {f}' for f in changed_files)}

Git Diff (first 3000 chars):
{diff_text[:3000]}

Generate a professional Pull Request summary with:
1. **📋 Summary**: One-paragraph description of the changes.
2. **🎯 Changes Made**: Bulleted list of specific changes.
3. **⚠️ Potential Blast Radius**: Files that might be affected (beyond directly changed files).
4. **✅ Testing Checklist**: Suggested tests to run.
5. **🏷️ Suggested Labels**: e.g., bug-fix, feature, refactor, breaking-change.

Be concise and professional."""

        pr_summary = gemini_generate(summary_prompt)

        return DebugResponse(
            blast_radius=blast_radius[:10],
            pr_summary=pr_summary,
            diff=diff_text,
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/architecture", response_model=ArchitectureResponse)
def get_architecture(req: ArchitectureRequest):
    """Generate architecture map nodes and edges."""
    # Default architecture for a full-stack app
    # In production, this would use RAG to analyze the actual repo
    nodes = [
        ArchitectureNode(id="client", label="Client", description="Next.js React frontend with Tailwind CSS. Handles all UI interactions, state management, and API communication.", x=100, y=250, color="#06b6d4"),
        ArchitectureNode(id="api", label="FastAPI Backend", description="Python FastAPI server handling ingestion, RAG queries, and commit analysis. Implements CORS and REST endpoints.", x=400, y=250, color="#6366f1"),
        ArchitectureNode(id="gemini", label="Google Gemini", description="Gemini 1.5 Flash for generation and text-embedding-004 for 768-dim vector embeddings via direct REST API calls.", x=700, y=100, color="#f59e0b"),
        ArchitectureNode(id="pinecone", label="Pinecone Vector DB", description="Serverless Pinecone index (AWS us-east-1, 768 dims, cosine metric) storing code chunk embeddings and metadata.", x=700, y=400, color="#10b981"),
        ArchitectureNode(id="github", label="GitHub API", description="Public GitHub REST API for repository zip downloads, commit diffs, and file metadata.", x=400, y=500, color="#8b5cf6"),
        ArchitectureNode(id="splitter", label="Text Splitter", description="LangChain RecursiveCharacterTextSplitter (chunk_size=1200, overlap=200) for intelligent code chunking.", x=400, y=50, color="#ec4899"),
    ]
    edges = [
        ArchitectureEdge(from_id="client", to_id="api", label="REST /api/*"),
        ArchitectureEdge(from_id="api", to_id="gemini", label="Embed & Generate"),
        ArchitectureEdge(from_id="api", to_id="pinecone", label="Upsert / Query"),
        ArchitectureEdge(from_id="api", to_id="github", label="Zipball / Commits"),
        ArchitectureEdge(from_id="api", to_id="splitter", label="Chunk Code"),
        ArchitectureEdge(from_id="splitter", to_id="gemini", label="Text → Vectors"),
    ]
    return ArchitectureResponse(nodes=nodes, edges=edges)


# ─────────────────────────────────────────────
# NEW ENDPOINTS
# ─────────────────────────────────────────────

class FilesRequest(BaseModel):
    repo_name: Optional[str] = None

class FilesResponse(BaseModel):
    files: List[dict]

class FileContentRequest(BaseModel):
    file_path: str
    repo_name: Optional[str] = None

class FileContentResponse(BaseModel):
    file_path: str
    content: str

class DocsRequest(BaseModel):
    file_path: str
    repo_name: Optional[str] = None

class DocsResponse(BaseModel):
    file_path: str
    documentation: str


@app.post("/api/files", response_model=FilesResponse)
def list_files(req: FilesRequest):
    """Return the list of ingested files from Pinecone metadata."""
    try:
        index = get_or_create_index()
        dummy_vector = [0.0] * EMBED_DIM
        filter_dict = {}
        if req.repo_name:
            filter_dict = {"repo_name": {"$eq": req.repo_name}}

        results = index.query(
            vector=dummy_vector,
            top_k=1000,
            include_metadata=True,
            filter=filter_dict if filter_dict else None,
        )

        seen_paths: set = set()
        files = []
        for match in results.matches:
            fp = match.metadata.get("file_path", "")
            rn = match.metadata.get("repo_name", "")
            if fp and fp not in seen_paths:
                seen_paths.add(fp)
                files.append({"path": fp, "repo_name": rn})

        return FilesResponse(files=files)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/file-content", response_model=FileContentResponse)
def get_file_content(req: FileContentRequest):
    """Return content of a specific file from Pinecone metadata."""
    try:
        index = get_or_create_index()
        query_vector = gemini_embed(f"content of file {req.file_path}")

        filter_dict: dict = {"file_path": {"$eq": req.file_path}}
        if req.repo_name:
            filter_dict["repo_name"] = {"$eq": req.repo_name}

        results = index.query(
            vector=query_vector,
            top_k=20,
            include_metadata=True,
            filter=filter_dict,
        )

        if not results.matches:
            raise HTTPException(status_code=404, detail=f"File '{req.file_path}' not found in index.")

        chunks = [m.metadata.get("text", "") for m in results.matches]
        content = "\n".join(chunks)
        return FileContentResponse(file_path=req.file_path, content=content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/docs", response_model=DocsResponse)
def generate_docs(req: DocsRequest):
    """Generate AI documentation for a specific file using RAG."""
    try:
        index = get_or_create_index()
        query_vector = gemini_embed(f"documentation for file {req.file_path}")

        filter_dict: dict = {"file_path": {"$eq": req.file_path}}
        if req.repo_name:
            filter_dict["repo_name"] = {"$eq": req.repo_name}

        results = index.query(
            vector=query_vector,
            top_k=10,
            include_metadata=True,
            filter=filter_dict if filter_dict else None,
        )

        if not results.matches:
            return DocsResponse(
                file_path=req.file_path,
                documentation="No content found for this file. Please ingest a repository first.",
            )

        context_chunks = [m.metadata.get("text", "") for m in results.matches]
        context = "\n\n".join(context_chunks)

        prompt = f"""You are InnovateBHARAT AI — an expert software architect generating living documentation.

FILE: {req.file_path}

CODE CONTEXT:
{context}

Generate comprehensive documentation for this file including:
1. **Purpose**: What this file/module does.
2. **Architecture Role**: How it fits into the overall system.
3. **Key Functions/Classes**: Brief description of each major component.
4. **Data Flow**: Step-by-step flow of data through this module.
5. **Dependencies**: What this module depends on.
6. **⚠️ Potential Issues**: Any anti-patterns or improvements to consider.

Format as clear, readable markdown documentation."""

        documentation = gemini_generate(prompt)
        return DocsResponse(file_path=req.file_path, documentation=documentation)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))