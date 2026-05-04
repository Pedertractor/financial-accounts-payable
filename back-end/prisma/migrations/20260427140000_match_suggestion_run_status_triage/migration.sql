-- Acelera filtro em loadInternalOnlyPoolForSumHints: run + OPEN + INTERNAL_ONLY
CREATE INDEX "MatchSuggestion_runId_status_triageBucket_idx" ON "MatchSuggestion"("runId", "status", "triageBucket");
