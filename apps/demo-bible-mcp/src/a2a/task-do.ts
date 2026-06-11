// Per-agent Durable Object task mailbox for the BSB A2A agent — durable, cross-isolate task store
// (one DO instance per agent SA via idFromName). Replaces the in-memory store: tasks persist across
// requests, and async processing is driven by alarm() (FR-3.2). The /api/a2a route forwards JSON-RPC
// here so message/send → submitted task → alarm → processDue → completed all share one durable store.

import { createDurableObjectTaskStore } from '@agenticprimitives/a2a/cloudflare';
import { handleA2aRpcBody, type TaskStore } from '@agenticprimitives/a2a';
import { buildBsbAgent, type A2aEnv } from './agent.js';

export class BsbTaskDO {
  private readonly store: TaskStore;
  constructor(private readonly ctx: DurableObjectState, private readonly env: A2aEnv) {
    this.store = createDurableObjectTaskStore(ctx.storage);
  }

  async fetch(request: Request): Promise<Response> {
    const body = await request.text();
    try {
      const res = await handleA2aRpcBody(buildBsbAgent(this.env, this.store), body);
      // A newly submitted task should be processed shortly — schedule the alarm.
      await this.ctx.storage.setAlarm(Date.now() + 50);
      return Response.json(res);
    } catch (e) {
      return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: (e as Error).message } });
    }
  }

  async alarm(): Promise<void> {
    const events = await buildBsbAgent(this.env, this.store).processDue();
    // W4 delivery (push/SSE fan-out of `events`) is deferred. Re-tick while work remains.
    if (events.length > 0) await this.ctx.storage.setAlarm(Date.now() + 250);
  }
}
