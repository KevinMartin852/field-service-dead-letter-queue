import assert from "node:assert/strict";
import test from "node:test";
import { decideDisposition, failedJobSchema } from "../src/job_disposition.ts";

test("routes the third failed visit to dead letter with its field record intact", () => {
  const job = failedJobSchema.parse({
    workOrderId: "WO-1842",
    dispatchStatus: "blocked",
    photoUrls: ["https://assets.example.test/work-orders/WO-1842/panel.jpg"],
    technicianFollowUp: "Confirm replacement breaker stock before redispatch.",
    attempts: 3,
    failedAt: "2026-08-14T02:30:00.000Z",
  });

  assert.deepEqual(decideDisposition(job), {
    action: "dead_letter",
    workOrderId: "WO-1842",
    reason: "attempt_limit_reached",
  });
  assert.equal(job.photoUrls.length, 1);
  assert.match(job.technicianFollowUp, /replacement breaker/);
});

test("keeps an earlier failure on the retry path", () => {
  const job = failedJobSchema.parse({
    workOrderId: "WO-1843",
    dispatchStatus: "en_route",
    photoUrls: [],
    technicianFollowUp: "Call customer to confirm access window.",
    attempts: 1,
    failedAt: "2026-08-14T03:00:00.000Z",
  });

  assert.deepEqual(decideDisposition(job), {
    action: "retry",
    workOrderId: "WO-1843",
    nextAttempt: 2,
  });
});
