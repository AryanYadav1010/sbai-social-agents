import { prisma } from "@/lib/db";

// Level 4 Improvement / Learning Loop -- pure Postgres retrieval, no vector
// DB, no LLM call, no training. Summarizes real, already-published,
// already-human-approved post performance into a compact text block that
// Trend/Audience Agents can inject into their own prompts as context
// ("in-context learning" via retrieval, not fine-tuning).
export async function getPerformanceHistorySummary(
  accountId: string,
  opts?: { limit?: number }
): Promise<string | undefined> {
  const limit = opts?.limit ?? 20;

  const posts = await prisma.socialPost.findMany({
    where: { accountId, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: {
      performanceSnapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
      },
    },
  });

  const withPerformance = posts
    .map((p) => ({ post: p, snapshot: p.performanceSnapshots[0] }))
    .filter((x) => x.snapshot);

  // Not enough real signal yet -- omit the section entirely rather than
  // inject a near-empty, potentially misleading summary.
  if (withPerformance.length < 3) return undefined;

  const ranked = [...withPerformance].sort((a, b) => {
    const scoreA = a.snapshot.totalInteractions ?? (a.snapshot.likeCount ?? 0) + (a.snapshot.commentsCount ?? 0);
    const scoreB = b.snapshot.totalInteractions ?? (b.snapshot.likeCount ?? 0) + (b.snapshot.commentsCount ?? 0);
    return scoreB - scoreA;
  });

  const top = ranked.slice(0, 5);
  const bottom = ranked.slice(-3).reverse();

  const formatLine = (x: (typeof ranked)[number]) => {
    const trend = x.post.trendContext as { angle?: string } | null;
    const angle = trend?.angle ? ` (angle: ${trend.angle})` : "";
    const score = x.snapshot.totalInteractions ?? (x.snapshot.likeCount ?? 0) + (x.snapshot.commentsCount ?? 0);
    const date = x.post.publishedAt ? new Date(x.post.publishedAt).toISOString().slice(0, 10) : "unknown date";
    return `- "${x.post.topic}"${angle} [${x.post.mediaType}] — ${score} interactions, published ${date}`;
  };

  const lines: string[] = ["Top-performing recent posts:", ...top.map(formatLine)];
  if (bottom.length > 0) {
    lines.push("Lower-performing recent posts:", ...bottom.map(formatLine));
  }

  return lines.join("\n");
}
