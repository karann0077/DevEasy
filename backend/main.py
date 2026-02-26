import os

            chunks = simple_chunk_text(text)
            for i, chunk in enumerate(chunks):
                chunk_id = str(uuid.uuid4())
                metadata = {
                    "repo": repo,
                    "repo_url": req.repo_url,
                    "path": rel_path,
                    "chunk_index": i,
                }

                # Call Gemini to get embedding (one-by-one as requested) with delay
                try:
                    vec = make_gemini_embedding(chunk)
                except Exception as e:
                    # If embedding fails, include the error and abort gracefully
                    raise Exception(f"Embedding failed for {rel_path}@{i}: {e}")

                # Ensure vector is exactly 768 dims
                if len(vec) != 768:
                    vec = vec[:768] + [0.0] * max(0, 768 - len(vec))

                upsert_buffer.append({
                    "id": chunk_id,
                    "values": vec,
                    "metadata": metadata,
                })
                chunks_count += 1

                # When buffer is large, upsert to Pinecone
                if len(upsert_buffer) >= UPSERT_BATCH:
                    logs.append(f"⤴️ Upserting batch of {len(upsert_buffer)} vectors to Pinecone")
                    upsert_to_pinecone(PINECONE_INDEX, upsert_buffer, logs)
                    upsert_buffer = []

                # delay between embedding calls to respect rate limits
                time.sleep(EMBED_DELAY)

        # final flush
        if upsert_buffer:
            logs.append(f"⤴️ Upserting final batch of {len(upsert_buffer)} vectors to Pinecone")
            upsert_to_pinecone(PINECONE_INDEX, upsert_buffer, logs)

        # cleanup
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass

        logs.append(f"🎉 Ingestion complete. Chunks ingested: {chunks_count}")
        return IngestResponse(status="success", logs=logs, chunks_ingested=chunks_count)

    except Exception as e:
        logs.append(f"❌ ERROR: {str(e)}")
        logs.append(traceback.format_exc())
        # Always return logs to the client for easier debugging
        raise HTTPException(status_code=500, detail={"logs": logs, "error": str(e)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=False)
