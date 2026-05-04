-- Index to better support listRunSuggestions ORDER BY (triageBucket, status, scorePercent) per run.
CREATE INDEX "MatchSuggestion_runId_triageBucket_status_scorePercent_idx" ON "MatchSuggestion"("runId", "triageBucket", "status", "scorePercent");
