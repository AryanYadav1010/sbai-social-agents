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
    <div className="mt-3 flex flex-col gap-3 rounded-lg bg-indigo-50/60 p-3 text-xs">
      {trendContext && (
        <div>
          <span className="font-semibold text-slate-700">Trend Agent:</span> <span className="text-slate-600">{trendContext.angle}</span>
          {trendContext.reasoning && <div className="mt-0.5 text-slate-500">{trendContext.reasoning}</div>}
          {trendContext.suggestedHashtags && trendContext.suggestedHashtags.length > 0 && (
            <div className="mt-0.5 text-slate-500">Hashtags: {trendContext.suggestedHashtags.join(" ")}</div>
          )}
          {trendContext.hashtagEnrichment && (
            <div className={`mt-0.5 ${trendContext.hashtagEnrichment.available ? "text-emerald-700" : "text-slate-400"}`}>
              {trendContext.hashtagEnrichment.available
                ? "✓ Enriched with real Instagram hashtag data"
                : `Hashtag research unavailable — reasoning-only (${trendContext.hashtagEnrichment.reason ?? "no reason given"})`}
            </div>
          )}
        </div>
      )}
      {audienceContext && (
        <div>
          <span className="font-semibold text-slate-700">Audience Agent:</span>{" "}
          <span className="text-slate-600">{audienceContext.targetingNotes}</span>
          {audienceContext.toneAdjustments && <div className="mt-0.5 text-slate-500">Tone: {audienceContext.toneAdjustments}</div>}
          {audienceContext.callToActionSuggestion && (
            <div className="mt-0.5 text-slate-500">CTA: {audienceContext.callToActionSuggestion}</div>
          )}
        </div>
      )}
    </div>
  );
}
