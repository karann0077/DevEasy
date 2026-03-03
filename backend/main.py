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
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_HOST = os.getenv("PINECONE_HOST")
PINECONE_INDEX = os.getenv("PINECONE_INDEX") or os.getenv("PINECONE_INDEX_NAME")
PORT = int(os.getenv("PORT", 8000))

# Startup logs
print(f"GEMINI_API_KEY set: {bool(GEMINI_API_KEY)}")
print(f"PINECONE_API_KEY set: {bool(PINECONE_API_KEY)}")
print(f"PINECONE_HOST: {PINECONE_HOST}")
print(f"PINECONE_INDEX: {PINECONE_INDEX}")

# Constants
ALLOWED_EXT = {".py", ".js", ".ts", ".jsx", ".tsx", ".cpp", ".c", ".h", ".md", ".json", ".yaml", ".yml", ".html", ".css"}
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
EMBED_DIM = 3072
EMBED_DELAY = 0.3
UPSERT_BATCH = 100

# Model config - ordered by preference (most quota -> least quota)
GENERATION_MODELS = [
    "gemini-1.5-flash",       # Primary: higher free-tier quota
    "gemini-1.5-flash-8b",    # Fallback 1: even more generous quota
    "gemini-2.0-flash",       # Fallback 2: original model
]

# Text Splitter
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    separators=["\n\n", "\n", " ", ""]
)

# Helper Functions
# ... (existing helper functions remain unchanged) ...


def make_gemini_generate(prompt: str) -> str:
    """
    Generate text using Gemini models with automatic fallback and retry.
    Primary: gemini-1.5-flash (higher free quota)
    Fallback: gemini-1.5-flash-8b, then gemini-2.0-flash
    """
    if not GEMINI_API_KEY:
        raise Exception("GEMINI_API_KEY is not set")

    last_error = None
    for model in GENERATION_MODELS:
        max_retries = 2
        for attempt in range(max_retries):
            try:
                result = _call_gemini_model(model, prompt)
                return result
            except Exception as e:
                err_str = str(e)
                if err_str.startswith("QUOTA_EXCEEDED:"):
                    # Extract wait time and retry once, then move to next model
                    try:
                        wait_secs = int(err_str.split(":")[1])
                    except:
                        wait_secs = 20
                    if attempt < max_retries - 1:
                        print(f"⏳ Quota exceeded on {model}, waiting {wait_secs}s before retry...")
                        time.sleep(wait_secs)
                        continue
                    else:
                        print(f"⚠️ Quota exhausted on {model}, trying next model...")
                        last_error = f"Quota exceeded on {model}"
                        break
                else:
                    last_error = err_str
                    break  # Non-quota error, try next model immediately

    raise Exception(f"All Gemini models failed. Last error: {last_error}")


# Pinecone Functions
# ... (existing functions remain unchanged) ...

# Endpoints
# ... (existing endpoints remain unchanged) ...

if __name__ == '__main__':
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)  

