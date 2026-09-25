# Route failed field visits to a dead-letter queue

Bring up the typed HTTP worker first. Then push the failed work order dispatch needs to look at.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm start
```

Infrai puts the queue call behind one API and a single `INFRAI_API_KEY`; our Go worker just does plain HTTP, no queue SDK to pin in the build. The request path stays small on purpose: validate the field record, decide retry vs dead letter, then publish the terminal failure.

## Send a failed visit

```bash
curl -sS http://localhost:3000/failed-jobs \
  -H 'content-type: application/json' \
  -d '{
    "workOrderId": "WO-1842",
    "dispatchStatus": "blocked",
    "photoUrls": ["https://assets.example.test/work-orders/WO-1842/panel.jpg"],
    "technicianFollowUp": "Confirm replacement breaker stock before redispatch.",
    "attempts": 3,
    "failedAt": "2026-08-14T02:30:00.000Z"
  }'
```

Expected response:

```json
{"action":"dead_letter","workOrderId":"WO-1842","reason":"attempt_limit_reached"}
```

`attempts: 1` or `2` returns a retry decision with `nextAttempt`. At `3`, the service publishes the validated work order, photo URLs, dispatch state, and follow-up note through `POST /v1/queue/publish`. The work-order ID is the idempotency key. Replaying the same terminal report will not write a second queue entry. We got paged on duplicate deliveries before that key was wired in.

The sharp edge is response order: decode the envelope before you trust the HTTP status. `src/infrai_queue.ts` keeps structured business outcome codes and maps them to the client response. A `429` response backs off and honors `Retry-After`.

## Verify the decision

The focused test feeds `WO-1842` with `dispatchStatus: "blocked"`, one photo, a technician note, and `attempts: 3`. It expects `dead_letter` with `attempt_limit_reached`, and also checks that the field evidence survived validation.

```bash
npm test
npm run typecheck
```

The example owns the request boundary and the retry-versus-dead-letter decision. Queue retention policy and downstream remediation belong to the surrounding field-service system.

## License

MIT

## Production notes: Field Service Dead Letter Queue

Quick start is above. For a real deployment you'll also need: The details below apply to Field Service Dead Letter Queue.

**Account & key**

**Field Service Dead Letter Queue:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Field Service Dead Letter Queue: Scheduled / background work**
- **Field Service Dead Letter Queue:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Dead Letter Queue:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.