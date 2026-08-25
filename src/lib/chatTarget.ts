/**
 * Pure chat-routing decision: where does the next chat stream go?
 *
 * Given the current session, the persisted quota-routing settings and the
 * model id selected in the picker, resolveChatTarget returns the apiKey/model/
 * baseUrl triple to hand to streamChat:
 *
 * - 'personal'  → session key + selected model against the moud gateway; this
 *   consumes the user's own personal moud quota.
 * - 'community' → session key + selected model against the moud gateway under
 *   community-pool semantics (same transport; the gateway decides pooling).
 * - 'byok'      → the user's own endpoint + key. The selected model only
 *   survives when it is verifiably part of the gateway catalog (the user
 *   picked it deliberately); stale or unknown ids fall back to the endpoint's
 *   own configured `modelId`, which is guaranteed to exist there. Without a
 *   usable BYOK config the request degrades gracefully to the gateway.
 *
 * Kept dependency-free so the routing contract is trivially unit-testable.
 */
import {ByokConfig, QuotaMode} from './byok';

export interface ChatTargetSession {
  apiKey: string;
}

export interface ChatTargetSettings {
  byok: ByokConfig | null;
  /** Active routing mode ('personal' | 'community' | 'byok'). */
  mode: QuotaMode;
}

export interface ResolveChatTargetOpts {
  /**
   * Ids currently listed by the gateway catalog (from fetchGatewayModels).
   * Omitted/empty means "no catalog knowledge": unknown ids are treated as
   * not-in-gateway and fall back to byok.modelId.
   */
  gatewayModelIds?: ReadonlySet<string> | null;
}

export interface ChatTarget {
  apiKey: string;
  model: string;
  /** undefined means the default moud gateway base URL. */
  baseUrl?: string;
  /** Which transport won — useful for debugging/UI hints. */
  route: 'gateway' | 'byok';
}

export function resolveChatTarget(
  session: ChatTargetSession,
  settings: ChatTargetSettings,
  selectedModel: string,
  opts: ResolveChatTargetOpts = {},
): ChatTarget {
  const gateway: ChatTarget = {
    apiKey: session.apiKey,
    model: selectedModel,
    baseUrl: undefined,
    route: 'gateway',
  };

  const {byok, mode} = settings;
  if (mode !== 'byok' || !byok) {
    // 'personal' and 'community' both travel through the moud gateway with
    // the session key; 'byok' without a usable config degrades gracefully.
    return gateway;
  }

  // BYOK routing: honor the personal endpoint and key. Keep the picked model
  // only when it is a known gateway-catalog id; otherwise prefer the model
  // configured on the custom endpoint itself.
  const knownInGateway = !!opts.gatewayModelIds?.has(selectedModel);
  return {
    apiKey: byok.apiKey,
    model: knownInGateway ? selectedModel : byok.modelId,
    baseUrl: byok.baseUrl,
    route: 'byok',
  };
}
