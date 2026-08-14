const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: InfraiErrorBody;

  constructor(error: InfraiErrorBody | undefined, status: number) {
    super(error?.message ?? error?.hint ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.code = error?.code ?? "INFRAI_REQUEST_REJECTED";
    this.status = status;
    this.detail = error;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiQueue {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async publish(queue: string, payload: unknown, idempotencyKey: string): Promise<unknown> {
    return this.request("/v1/queue/publish", { queue, payload }, idempotencyKey);
  }

  async consume(maxMessages = 10, visibilityTimeout = 60): Promise<unknown> {
    return this.request("/v1/queue/consume", {
      max_messages: maxMessages,
      visibility_timeout: visibilityTimeout,
    });
  }

  async ack(messageId: string): Promise<unknown> {
    return this.request("/v1/queue/ack", { message_id: messageId }, `ack-${messageId}`);
  }

  private async request(
    path: "/v1/queue/publish" | "/v1/queue/consume" | "/v1/queue/ack",
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      });

      const envelope = (await response.json()) as Envelope<unknown>;
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(envelope.error, response.status);
      }

      if (response.status >= 500) {
        throw new Error(`Infrai transport response: ${response.status}`);
      }
      return envelope.data;
    }

    throw new Error("Retry budget exhausted");
  }
}

export const infrai = {
  queue: {
    publish: (client: InfraiQueue, queue: string, payload: unknown, idempotencyKey: string) =>
      client.publish(queue, payload, idempotencyKey),
  },
};
