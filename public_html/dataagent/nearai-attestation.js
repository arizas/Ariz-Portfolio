// Whether a NEAR AI model really runs in a confidential enclave, checked in this
// browser rather than taken from NEAR AI's word.
//
// NEAR AI serves an attestation report for each model it runs in its own secure
// hardware. The report holds an Intel TDX quote: a statement signed by the CPU,
// through a certificate chain that ends at Intel's root, that names the software
// running (its measurements) and carries 64 bytes the software chose (report
// data). Here the report data must be the enclave's signing key and a random
// nonce made in this browser, so the key provably lives in that enclave and the
// report was made now, for this request. The GPUs' evidence goes to NVIDIA's
// attestation service, whose verdict NVIDIA signs; that signature and the nonce
// in it are checked here, so the relay that carries it need not be trusted.
//
// What is trusted, then: Intel's hardware and root key, NVIDIA's signing key, and
// the software the quote measures. The page shows that software (its container
// images) because whether it is acceptable is the owner's judgment, not a check.
//
// Intel's collateral (certificates, revocation lists, TCB levels) comes from
// Phala's public cache, which browsers may read. Everything in it is signed by
// Intel and checked against the root built into the verifier, so the cache need
// not be trusted either.

import * as dcapModule from '@phala/dcap-qvl';

const dcap = dcapModule.default ?? dcapModule;

export const NEAR_AI_API = 'https://cloud-api.near.ai';
export const PCCS_URL = 'https://pccs.phala.network';
export const NVIDIA_JWKS_URL = 'https://nras.attestation.nvidia.com/.well-known/jwks.json';
const NVIDIA_ISSUER = 'https://nras.attestation.nvidia.com';

/** TCB states in which the quote's signature chain is sound. Others fail. */
const TCB_OK = new Set(['UpToDate', 'SWHardeningNeeded', 'ConfigurationNeeded', 'ConfigurationAndSWHardeningNeeded', 'OutOfDate', 'OutOfDateConfigurationNeeded']);

export const hexToBytes = (hex) => {
    const clean = String(hex).replace(/^0x/i, '');
    if (!/^([0-9a-f]{2})*$/i.test(clean)) throw new Error('not hex');
    return Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16));
};
export const bytesToHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const equalBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const base64urlToBytes = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const jsonOf = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

export async function sha256Hex(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

export function randomNonce() {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** NEAR AI's attestation report for a model, with Ed25519 keys. Needs no account. */
export async function fetchAttestationReport(model, nonce, { fetchFn = fetch } = {}) {
    const url = `${NEAR_AI_API}/v1/attestation/report?model=${encodeURIComponent(model)}&nonce=${nonce}&signing_algo=ed25519`;
    const response = await fetchFn(url);
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.error) {
        const message = body?.error?.message ?? body?.error ?? `HTTP ${response.status}`;
        throw Object.assign(new Error(String(message)), { status: response.status });
    }
    return body;
}

/**
 * Verify an Intel TDX quote against Intel's root.
 * @returns {{status: string, advisoryIds: string[], reportData: Uint8Array, mrConfigId: Uint8Array}}
 */
export async function verifyTdxQuote(quoteHex, { collateralFor = (quote) => dcap.getCollateral(PCCS_URL, quote), nowSecs = Math.floor(Date.now() / 1000) } = {}) {
    const quote = hexToBytes(quoteHex);
    const result = await dcap.verify(quote, await collateralFor(quote), nowSecs);
    if (!TCB_OK.has(result.status)) throw new Error(`Intel rates this platform ${result.status}`);
    const data = result.report?.data;
    if (!data?.reportData) throw new Error(`unexpected quote type ${result.report?.type}`);
    return {
        status: result.status,
        advisoryIds: result.advisory_ids ?? [],
        reportData: new Uint8Array(data.reportData),
        mrConfigId: new Uint8Array(data.mrConfigId),
    };
}

/** Report data is the signing key, right-padded to 32 bytes, then the nonce. */
export function reportDataBinds(reportData, signingKeyHex, nonceHex) {
    const key = hexToBytes(signingKeyHex);
    if (key.length > 32) return { key: false, nonce: false };
    const padded = new Uint8Array(32);
    padded.set(key);
    return {
        key: equalBytes(reportData.subarray(0, 32), padded),
        nonce: equalBytes(reportData.subarray(32, 64), hexToBytes(nonceHex)),
    };
}

/**
 * The software the quote measures: its configuration must hash to the quote's
 * mrConfigId, and the configuration names the container images.
 */
export async function attestedSoftware(attestation, mrConfigId) {
    const info = jsonOf(attestation.info) ?? {};
    const tcb = jsonOf(info.tcb_info) ?? {};
    const appCompose = tcb.app_compose;
    if (typeof appCompose !== 'string') return { matches: false, images: [], appName: info.app_name ?? null };
    const expected = '01' + await sha256Hex(appCompose);
    const compose = jsonOf(appCompose)?.docker_compose_file ?? '';
    const images = [...new Set([...compose.matchAll(/image:\s*["']?([^\s"']+)/g)].map((m) => m[1]))];
    return { matches: bytesToHex(mrConfigId).startsWith(expected), images, appName: info.app_name ?? null };
}

/**
 * NVIDIA's verdict on the GPUs, checked here: its signature against NVIDIA's
 * published key, its issuer, its expiry, our nonce in it, and the verdict.
 * `relay` sends the evidence to NVIDIA and returns NVIDIA's answer unchanged.
 */
export async function verifyGpuEvidence(nvidiaPayload, nonceHex, { relay, jwks, nowSecs = Math.floor(Date.now() / 1000) }) {
    const payload = jsonOf(nvidiaPayload);
    if (String(payload?.nonce).toLowerCase() !== nonceHex.toLowerCase()) throw new Error('the GPU evidence is not for this request\'s nonce');
    const answer = await relay(payload);
    const token = Array.isArray(answer?.[0]) && answer[0][0] === 'JWT' ? answer[0][1] : null;
    if (typeof token !== 'string') throw new Error('NVIDIA did not answer with a signed verdict');
    const claims = await verifyNvidiaJwt(token, jwks);
    if (claims.iss !== NVIDIA_ISSUER) throw new Error(`the verdict was issued by ${claims.iss}`);
    if (typeof claims.exp !== 'number' || claims.exp < nowSecs) throw new Error('NVIDIA\'s verdict has expired');
    if (String(claims.eat_nonce).toLowerCase() !== nonceHex.toLowerCase()) throw new Error('NVIDIA\'s verdict is for another nonce');
    if (claims['x-nvidia-overall-att-result'] !== true) throw new Error('NVIDIA did not attest these GPUs');
    return { gpus: payload.evidence_list?.length ?? 0, arch: payload.arch ?? null };
}

async function verifyNvidiaJwt(token, jwks) {
    const [headerPart, payloadPart, signaturePart] = token.split('.');
    const header = JSON.parse(new TextDecoder().decode(base64urlToBytes(headerPart)));
    if (header.alg !== 'ES384') throw new Error(`unexpected signature algorithm ${header.alg}`);
    const jwk = (await jwks()).keys?.find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('NVIDIA\'s verdict is signed by a key NVIDIA does not publish');
    const { kty, crv, x, y } = jwk;
    const key = await crypto.subtle.importKey('jwk', { kty, crv, x, y }, { name: 'ECDSA', namedCurve: 'P-384' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-384' }, key, base64urlToBytes(signaturePart),
        new TextEncoder().encode(`${headerPart}.${payloadPart}`));
    if (!valid) throw new Error('NVIDIA\'s signature on the verdict does not verify');
    return JSON.parse(new TextDecoder().decode(base64urlToBytes(payloadPart)));
}

/**
 * Verify a model, start to finish.
 *
 * @returns {Promise<{model: string, verified: boolean, signingKey: string|null,
 *   checks: {id: string, ok: boolean, label: string, detail?: string}[],
 *   software: {gateway: object|null, model: object|null}, verifiedAt: string}>}
 * `verified` is true only when every check passed; `signingKey` is the
 * model enclave's attested Ed25519 key, to encrypt to and check answers with.
 */
export async function verifyModel(model, {
    fetchFn = fetch,
    nonce = randomNonce(),
    collateralFor,
    relayGpu,
    jwks = async () => (await fetchFn(NVIDIA_JWKS_URL)).json(),
    nowSecs = Math.floor(Date.now() / 1000),
} = {}) {
    const checks = [];
    const check = async (id, label, run) => {
        try {
            const detail = await run();
            checks.push({ id, ok: true, label, ...(detail ? { detail } : {}) });
            return true;
        } catch (error) {
            checks.push({ id, ok: false, label, detail: String(error?.message ?? error) });
            return false;
        }
    };
    const software = { gateway: null, model: null };
    let signingKey = null;

    let report = null;
    await check('report', 'NEAR AI serves an attestation report for this model', async () => {
        report = await fetchAttestationReport(model, nonce, { fetchFn });
    });
    const candidates = (report?.model_attestations ?? []).filter((a) => !a.model_name || a.model_name === model);
    if (report && candidates.length === 0) checks.push({ id: 'model-enclave', ok: false, label: 'The model runs in a confidential enclave', detail: 'the report lists no enclave for this model' });

    // A model NEAR AI serves through another confidential-computing provider
    // (Kimi at Chutes: quote_b64, its own key binding, an ML-KEM key) comes in a
    // format this page cannot check yet. Said as such, not as a failed check.
    const foreign = candidates.find((a) => typeof a.intel_quote !== 'string');
    if (foreign) {
        checks.push({
            id: 'format', ok: false, unsupported: true, provider: foreign.provider ?? null,
            label: 'The report is in a format this browser can check',
            detail: `the model runs at ${foreign.provider ?? 'another provider'}, whose attestation this page cannot check yet`,
        });
        return { model, verified: false, signingKey: null, checks, software, verifiedAt: new Date(nowSecs * 1000).toISOString() };
    }

    // Every candidate must verify: the gateway may route to any of them.
    for (const [index, attestation] of candidates.entries()) {
        const n = candidates.length > 1 ? ` (${index + 1} of ${candidates.length})` : '';
        let quote = null;
        await check('model-quote', `Intel signed the model enclave's report${n}`, async () => {
            quote = await verifyTdxQuote(attestation.intel_quote, { collateralFor, nowSecs });
            return quote.status === 'UpToDate' ? null : `TCB status ${quote.status}${quote.advisoryIds.length ? `, advisories ${quote.advisoryIds.join(', ')}` : ''}`;
        });
        await check('model-binding', `The report binds the model's key and this browser's fresh nonce${n}`, async () => {
            if (!quote) throw new Error('no verified quote');
            if (attestation.signing_algo && attestation.signing_algo !== 'ed25519') throw new Error(`signing algorithm ${attestation.signing_algo}`);
            const binds = reportDataBinds(quote.reportData, attestation.signing_address, nonce);
            if (!binds.key) throw new Error('the report data does not hold the model\'s signing key');
            if (!binds.nonce) throw new Error('the report data does not hold this request\'s nonce: it may be replayed');
        });
        await check('model-software', `The report names the software it runs${n}`, async () => {
            if (!quote) throw new Error('no verified quote');
            software.model = await attestedSoftware(attestation, quote.mrConfigId);
            if (!software.model.matches) throw new Error('the configuration in the report does not match the quote');
        });
        await check('gpu', `NVIDIA attests the GPUs are in confidential mode${n}`, async () => {
            if (!relayGpu) throw new Error('no way to reach NVIDIA\'s attestation service');
            const gpu = await verifyGpuEvidence(attestation.nvidia_payload, nonce, { relay: relayGpu, jwks, nowSecs });
            return `${gpu.gpus} ${gpu.arch ?? ''} GPU${gpu.gpus === 1 ? '' : 's'}`.replace(/\s+/g, ' ');
        });
        // Requests are pinned to the first candidate's key (X-Model-Pub-Key).
        signingKey ??= attestation.signing_address;
    }

    // The gateway routes the request. With the request encrypted to the model's
    // key it cannot read it, so this is shown rather than required.
    const gateway = report?.gateway_attestation;
    if (gateway?.intel_quote) {
        const gatewayCheck = { id: 'gateway', label: 'Intel signed NEAR AI\'s gateway enclave\'s report', informational: true };
        try {
            const quote = await verifyTdxQuote(gateway.intel_quote, { collateralFor, nowSecs });
            const binds = reportDataBinds(quote.reportData, gateway.signing_address, nonce);
            software.gateway = await attestedSoftware(gateway, quote.mrConfigId);
            checks.push({ ...gatewayCheck, ok: binds.key && binds.nonce && software.gateway.matches });
        } catch (error) {
            checks.push({ ...gatewayCheck, ok: false, detail: String(error?.message ?? error) });
        }
    }

    const required = checks.filter((c) => !c.informational);
    return {
        model,
        verified: candidates.length > 0 && required.length > 0 && required.every((c) => c.ok),
        signingKey: candidates.length > 0 ? signingKey : null,
        checks,
        software,
        verifiedAt: new Date(nowSecs * 1000).toISOString(),
    };
}
