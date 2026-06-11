// BSB Corpus-Manager (bsb.impact) A2A skills — the reader-facing entitlement conversation on the
// async, delegation-authorized bus (@agenticprimitives/a2a, spec 269). Handlers are transport-free:
// they use ctx.principal (the verified reader = delegation.delegator), ctx.mcp (our entitlement
// tools via the a2a→mcp seam), ctx.vault (deliver into a principal's vault), and ctx.emitArtifact.

import type { SkillHandler, SkillContext, SkillResult } from '@agenticprimitives/a2a';

/** Reader → BSB: file an entitlement request. Subject = the VERIFIED principal (never client input);
 *  the runtime hands us the reader's captured grant in ctx.delegation, persisted for right-away vault
 *  delivery at grant time. Owner approval happens out-of-band (demo-corpus). */
export const requestEntitlement: SkillHandler = {
  skill: 'request-entitlement',
  async handle(ctx: SkillContext): Promise<SkillResult> {
    const input = (ctx.input ?? {}) as { edition?: string; note?: string };
    if (!input.edition) return { state: 'failed', error: 'edition required' };
    const r = (await ctx.mcp.callTool({
      tool: 'request_entitlement',
      toolArgs: { subject: ctx.principal, edition: input.edition, note: input.note, readerDelegation: ctx.delegation },
    })) as { ok?: boolean; requestId?: number; error?: string };
    if (!r?.ok) return { state: 'failed', error: r?.error ?? 'request failed' };
    const artifactId = await ctx.emitArtifact({ artifactKind: 'entitlement-request', body: { requestId: r.requestId, edition: input.edition, status: 'pending' } });
    return { state: 'completed', artifactIds: [artifactId] };
  },
};

/** (Scripture Agent, on the reader's behalf) → BSB: gated verse text. Presenter-binding is enforced at
 *  the MCP against ctx.principal (the verified reader); the held entitlement VC is supplied as input.
 *  Fails closed on a bad/revoked/mismatched entitlement (the MCP returns ok:false). */
export const getGatedPassage: SkillHandler = {
  skill: 'get-gated-passage',
  async handle(ctx: SkillContext): Promise<SkillResult> {
    const input = (ctx.input ?? {}) as { reference?: string; edition?: string; entitlement?: unknown };
    if (!input.reference || !input.edition) return { state: 'failed', error: 'reference + edition required' };
    const r = (await ctx.mcp.callTool({
      tool: 'get_passage_text',
      toolArgs: { reference: input.reference, edition: input.edition, subject: ctx.principal, entitlement: input.entitlement },
    })) as { ok?: boolean; text?: string; commitment?: unknown; commitmentOk?: boolean; error?: string };
    if (!r?.ok) return { state: 'failed', error: r?.error ?? 'access denied' };
    const artifactId = await ctx.emitArtifact({ artifactKind: 'verse-text', body: { text: r.text, commitment: r.commitment, commitmentOk: r.commitmentOk } });
    return { state: 'completed', artifactIds: [artifactId] };
  },
};

export const BSB_AGENT_SKILLS: SkillHandler[] = [requestEntitlement, getGatedPassage];
