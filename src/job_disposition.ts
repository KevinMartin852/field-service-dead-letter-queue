import { z } from "zod";

export const failedJobSchema = z.object({
  workOrderId: z.string().min(1),
  dispatchStatus: z.enum(["assigned", "en_route", "on_site", "blocked"]),
  photoUrls: z.array(z.string().url()).max(20),
  technicianFollowUp: z.string().min(1).max(1000),
  attempts: z.number().int().min(1),
  failedAt: z.string().datetime(),
});

export type FailedJob = z.infer<typeof failedJobSchema>;

export type JobDisposition =
  | { action: "retry"; workOrderId: string; nextAttempt: number }
  | { action: "dead_letter"; workOrderId: string; reason: "attempt_limit_reached" };

export function decideDisposition(job: FailedJob, attemptLimit = 3): JobDisposition {
  if (job.attempts >= attemptLimit) {
    return {
      action: "dead_letter",
      workOrderId: job.workOrderId,
      reason: "attempt_limit_reached",
    };
  }

  return {
    action: "retry",
    workOrderId: job.workOrderId,
    nextAttempt: job.attempts + 1,
  };
}
