import type { Task } from "graphile-worker";
import { workerPrisma } from "@/src/worker/queue/db";
import { refreshPostAnalytics } from "@/lib/agents/analyticsAgent";

// Background counterpart to the dashboard's manual "Refresh analytics"
// button (lib/agents/analyticsAgent.ts) -- run periodically via cron
// (see src/worker/index.ts) so the Learning Loop's performance history
// stays current without a human needing to click through every published
// post. Read-only against the platform APIs; never touches publish state.
const refreshPerformance: Task = async (_payload, helpers) => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // don't bother refreshing ancient posts
  const posts = await workerPrisma.socialPost.findMany({
    where: { status: "PUBLISHED", publishedAt: { gte: cutoff }, account: { platform: "INSTAGRAM" } }, // Analytics Agent only supports Instagram today (metaEcosystem.ts)
    select: { id: true },
    take: 50, // bounded per tick -- this is a periodic sweep, not a one-shot batch job
  });

  for (const post of posts) {
    try {
      await refreshPostAnalytics(post.id);
    } catch (err) {
      helpers.logger.warn(`Analytics refresh failed for post ${post.id}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }
};

export default refreshPerformance;
