export interface TrendContext {
  angle?: string;
  format?: string;
  suggestedHashtags?: string[];
  reasoning?: string;
  hashtagEnrichment?: {
    available: boolean;
    hashtags?: { tag: string; topMediaSample: { likeCount: number; commentsCount: number }[] }[];
    reason?: string;
  };
}

export interface AudienceContext {
  targetingNotes?: string;
  toneAdjustments?: string;
  callToActionSuggestion?: string;
}

export default function TrendAudiencePanel({
  trendContext,
  audienceContext,
}: {
  trendContext: TrendContext | null;
  audienceContext: AudienceContext | null;
}) {
  if (!trendContext && !audienceContext) return null;

  return (
    <div style={{ marginTop: 8, padding: "8px 12px", background: "#f2f5fb", borderRadius: 6, fontSize: 12 }}>
      {trendContext && (
        <div style={{ marginBottom: audienceContext ? 6 : 0 }}>
          <strong>Trend Agent:</strong> {trendContext.angle}
          {trendContext.reasoning && <div style={{ color: "#555" }}>{trendContext.reasoning}</div>}
          {trendContext.suggestedHashtags && trendContext.suggestedHashtags.length > 0 && (
            <div style={{ color: "#555" }}>Hashtags: {trendContext.suggestedHashtags.join(" ")}</div>
          )}
          {trendContext.hashtagEnrichment && (
            <div style={{ color: trendContext.hashtagEnrichment.available ? "#16803d" : "#888" }}>
              {trendContext.hashtagEnrichment.available
                ? "✓ Enriched with real Instagram hashtag data"
                : `Hashtag research unavailable — reasoning-only (${trendContext.hashtagEnrichment.reason ?? "no reason given"})`}
            </div>
          )}
        </div>
      )}
      {audienceContext && (
        <div>
          <strong>Audience Agent:</strong> {audienceContext.targetingNotes}
          {audienceContext.toneAdjustments && <div style={{ color: "#555" }}>Tone: {audienceContext.toneAdjustments}</div>}
          {audienceContext.callToActionSuggestion && (
            <div style={{ color: "#555" }}>CTA: {audienceContext.callToActionSuggestion}</div>
          )}
        </div>
      )}
    </div>
  );
}
