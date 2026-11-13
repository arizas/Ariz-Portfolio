// Which models the assistant can use, and what the owner is told about each.
//
// The list is NEAR AI's, and every model in it can be chosen: some run in NEAR
// AI's confidential hardware, others are passed to the company that makes them.
// Which is which is never taken from the list: the page verifies the chosen
// model itself (nearai-attestation.js), and the wording below says exactly what
// that verification showed, and what it means for the owner's data.

import { NEAR_AI_API } from './nearai-attestation.js';

/** Not chat models: they cannot run the assistant. */
const NOT_CHAT = /embedding|reranker|whisper|flux|privacy-filter|jev-|sage-/i;

/** NEAR AI's chat models, sorted by name. */
export async function fetchChatModels({ fetchFn = fetch } = {}) {
    const response = await fetchFn(`${NEAR_AI_API}/v1/models`);
    if (!response.ok) throw new Error(`NEAR AI did not list its models (HTTP ${response.status})`);
    const { data = [] } = await response.json();
    return data
        .filter((m) => typeof m?.id === 'string' && !NOT_CHAT.test(m.id))
        .filter((m) => (m.architecture?.outputModalities ?? m.output_modalities ?? ['text']).includes('text'))
        .map((m) => ({ id: m.id, name: m.name ?? m.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

const READERS = 'Your questions, and whatever the assistant reads from your store or its scripts print, go unencrypted to NEAR AI and to the company that runs the model, who can read them.';

/**
 * What the page says about the chosen model.
 * @param {{id: string, name?: string}} model
 * @param {object|null} result verifyModel's result, or null while it runs
 * @returns {{kind: 'checking'|'private'|'not-private'|'unsupported'|'failed', text: string, acknowledge?: string}}
 */
export function privacyStatement(model, result) {
    const name = model.name ?? model.id;
    if (!result) return { kind: 'checking', text: `Checking that ${name} runs in confidential hardware…` };
    if (result.verified) {
        return {
            kind: 'private',
            text: `Private. ${name} runs in confidential hardware that this browser verified: Intel and NVIDIA attest it, and its report binds the key your questions are encrypted to. NEAR AI passes them on but cannot read them, and each answer is checked to be signed by that hardware.`,
        };
    }
    const acknowledge = `I understand, and accept this for ${name}`;
    const report = result.checks.find((c) => c.id === 'report');
    if (!report?.ok) {
        return {
            kind: 'not-private',
            text: `Not private. NEAR AI could not show that ${name} runs in confidential hardware (it said: "${report?.detail ?? 'no report'}"). ${READERS}`,
            acknowledge,
        };
    }
    const unsupported = result.checks.find((c) => c.unsupported);
    if (unsupported) {
        const provider = unsupported.provider ? `${unsupported.provider[0].toUpperCase()}${unsupported.provider.slice(1)}` : 'another provider';
        return {
            kind: 'unsupported',
            text: `Not verified. NEAR AI runs ${name} at ${provider}, in confidential hardware by NEAR AI's account, but this page cannot check ${provider}'s attestation yet, so it cannot encrypt to it either. ${READERS}`,
            acknowledge,
        };
    }
    const failure = result.checks.find((c) => !c.ok && !c.informational);
    return {
        kind: 'failed',
        text: `Not verified. ${name} should run in confidential hardware, but a check failed: ${failure ? `${failure.label}: ${failure.detail ?? 'failed'}` : 'no enclave was listed'}. Until it passes, it is not private. ${READERS}`,
        acknowledge,
    };
}
