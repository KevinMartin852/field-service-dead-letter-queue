import { createServer } from "node:http";
import { decideDisposition, failedJobSchema } from "./job_disposition.ts";
import { InfraiError, InfraiQueue, infrai } from "./infrai_queue.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the worker");

const queue = new InfraiQueue(apiKey);
const deadLetterQueue = "field-service-dead-letter";
const port = Number(process.env.PORT ?? 3000);

function sendJson(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/failed-jobs") {
    sendJson(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const job = failedJobSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const disposition = decideDisposition(job);

    if (disposition.action === "dead_letter") {
      await infrai.queue.publish(
        queue,
        deadLetterQueue,
        { job, disposition },
        `dead-letter-${job.workOrderId}`,
      );
      sendJson(response, 202, disposition);
      return;
    }

    sendJson(response, 200, disposition);
  } catch (error) {
    if (error instanceof InfraiError) {
      sendJson(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
        message: error.message,
      });
      return;
    }
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
      sendJson(response, 400, { error: "invalid_request" });
      return;
    }
    sendJson(response, 500, { error: "request_failed" });
  }
});

server.listen(port, () => {
  console.log(`field-service DLQ worker listening on http://localhost:${port}`);
});
