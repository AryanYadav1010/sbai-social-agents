import type { Task, TaskList } from "graphile-worker";
import schedulerTick from "@/src/worker/tasks/schedulerTick";
import runScheduleNow from "@/src/worker/tasks/runScheduleNow";
import generateSocialDraft from "@/src/worker/tasks/generateSocialDraft";
import generateVideo from "@/src/worker/tasks/generateVideo";
import checkVideoStatus from "@/src/worker/tasks/checkVideoStatus";
import refreshPerformance from "@/src/worker/tasks/refreshPerformance";
import publishApprovedPost from "@/src/worker/tasks/publishApprovedPost";
import maintenance from "@/src/worker/tasks/maintenance";

// Exposed so the heartbeat can report "currently running job count"
// (spec: worker identity and heartbeat) without needing to reach into
// graphile-worker's own internals, which don't expose this directly.
export let runningJobCount = 0;

function countingWrapper(task: Task): Task {
  return async (payload, helpers) => {
    runningJobCount += 1;
    try {
      return await task(payload, helpers);
    } finally {
      runningJobCount -= 1;
    }
  };
}

const rawTasks: Record<string, Task> = {
  schedulerTick,
  runScheduleNow,
  generateSocialDraft,
  generateVideo,
  checkVideoStatus,
  refreshPerformance,
  publishApprovedPost,
  maintenance,
};

export const taskList: TaskList = Object.fromEntries(
  Object.entries(rawTasks).map(([name, task]) => [name, countingWrapper(task)])
);
