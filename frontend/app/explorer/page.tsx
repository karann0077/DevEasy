  const handleExplain = async () => {
    setLoading(true);
    setPanelOpen(true);
    setExplanation("");

    try {
      const resp = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // FIX #6: Embed the actual code into the query field instead of sending
        // a separate "code" field that the backend ignores
        body: JSON.stringify({
          query: `Explain the following code and identify any performance issues, architectural concerns, and improvement suggestions:\n\n${MOCK_CODE_TEXT}`,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "API error");
      setExplanation(data.answer);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setExplanation(`**Error:** ${msg}`);
    } finally {
      setLoading(false);
    }
  };
