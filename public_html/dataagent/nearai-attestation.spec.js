import { bytesToHex, reportDataBinds, sha256Hex, verifyModel } from './nearai-attestation.js';

// One live verification of deepseek-ai/DeepSeek-V4.1-Flash-1017, recorded on
// 2026-11-13: NEAR AI's report for a nonce made then, Intel's collateral for each
// quote, NVIDIA's signed verdict and NVIDIA's key. Checked with the clock at the
// moment of recording, so the real formats are tested without the network.
let recording;
const BYTE_FIELDS = ['root_ca_crl', 'pck_crl', 'tcb_info_signature', 'qe_identity_signature'];

function inputs(over = {}) {
    const r = recording;
    const report = over.report ?? r.report;
    return {
        nonce: r.nonce,
        nowSecs: r.nowSecs,
        fetchFn: async (url) => {
            expect(url).to.contain(`nonce=${r.nonce}`);
            expect(url).to.contain('signing_algo=ed25519');
            return new Response(JSON.stringify(report), { status: report.error ? 400 : 200 });
        },
        collateralFor: async (quote) => {
            const collateral = { ...r.collateral[await sha256Hex(quote)] };
            if (!collateral.tcb_info) throw new Error('no collateral recorded for this quote');
            for (const field of BYTE_FIELDS) collateral[field] = Uint8Array.from(collateral[field]);
            return collateral;
        },
        relayGpu: async () => over.nvidia ?? Object.values(r.nvidia)[0],
        jwks: async () => r.jwks,
        ...over.options,
    };
}

const failed = (result) => result.checks.filter((c) => !c.ok && !c.informational).map((c) => c.id);

describe('verifying a NEAR AI model in the browser', function () {
    before(async () => {
        recording = await (await fetch('/testdata/nearai-attestation/recording.json')).json();
    });

    it('verifies the recorded model: Intel quote, key and nonce, software, GPUs', async function () {
        this.timeout(30000);
        const result = await verifyModel(recording.model, inputs());
        expect(failed(result)).to.deep.equal([]);
        expect(result.verified).to.be.true;
        expect(result.signingKey).to.equal(recording.report.model_attestations[0].signing_address);
        expect(result.checks.map((c) => c.id)).to.include.members(['report', 'model-quote', 'model-binding', 'model-software', 'gpu', 'gateway']);
        expect(result.checks.find((c) => c.id === 'gateway').ok).to.be.true;
        expect(result.checks.find((c) => c.id === 'gpu').detail).to.equal('8 HOPPER GPUs');
        expect(result.software.model.images.some((image) => image.includes('compose-manager'))).to.be.true;
        expect(result.software.gateway.images.some((image) => image.includes('nearaidev/cloud-api'))).to.be.true;
    });

    it('rejects a report made for another nonce: it could be a replay', async function () {
        this.timeout(30000);
        const other = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
        const result = await verifyModel(recording.model, inputs({ options: { nonce: other, fetchFn: async () => new Response(JSON.stringify(recording.report)) } }));
        expect(result.verified).to.be.false;
        expect(failed(result)).to.include.members(['model-binding', 'gpu']);
    });

    it('rejects a quote with one byte changed', async function () {
        this.timeout(30000);
        const report = structuredClone(recording.report);
        const quote = report.model_attestations[0].intel_quote;
        const at = 2 * 1000; // inside the TD report body Intel signed
        report.model_attestations[0].intel_quote = quote.slice(0, at) + (quote[at] === '0' ? '1' : '0') + quote.slice(at + 1);
        const result = await verifyModel(recording.model, inputs({ report, options: { collateralFor: inputs().collateralFor } }));
        expect(result.verified).to.be.false;
        expect(failed(result)).to.include('model-quote');
    });

    it('rejects a key the quote does not bind', async function () {
        this.timeout(30000);
        const report = structuredClone(recording.report);
        report.model_attestations[0].signing_address = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
        const result = await verifyModel(recording.model, inputs({ report }));
        expect(result.verified).to.be.false;
        expect(failed(result)).to.deep.equal(['model-binding']);
    });

    it('rejects a verdict whose claims were altered after NVIDIA signed them', async function () {
        this.timeout(30000);
        const answer = structuredClone(Object.values(recording.nvidia)[0]);
        const [header, payload, signature] = answer[0][1].split('.');
        const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        claims['x-nvidia-overall-att-result'] = true;
        claims.dbgstat = 'disabled';
        const forged = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        answer[0][1] = `${header}.${forged}.${signature}`;
        const result = await verifyModel(recording.model, inputs({ nvidia: answer }));
        expect(failed(result)).to.deep.equal(['gpu']);
        expect(result.checks.find((c) => c.id === 'gpu').detail).to.match(/signature/);
    });

    it('rejects NVIDIA\'s verdict once it has expired', async function () {
        this.timeout(30000);
        const result = await verifyModel(recording.model, inputs({ options: { nowSecs: recording.nowSecs + 2 * 3600 } }));
        expect(failed(result)).to.include('gpu');
        expect(result.checks.find((c) => c.id === 'gpu').detail).to.match(/expired/);
    });

    it('does not verify a model NEAR AI forwards to an outside provider', async () => {
        const report = { error: { message: 'Provider error: Failed to fetch attestation report: TEE attestation is not supported for external providers' } };
        const result = await verifyModel('anthropic/claude-sonnet-5-5', inputs({ report }));
        expect(result.verified).to.be.false;
        expect(result.signingKey).to.equal(null);
        expect(result.checks[0]).to.include({ id: 'report', ok: false });
        expect(result.checks[0].detail).to.match(/external providers/);
    });

    it('reads report data as the key, right-padded, then the nonce', () => {
        const key = 'ab'.repeat(20);
        const nonce = 'cd'.repeat(32);
        const data = new Uint8Array(64);
        data.set(Uint8Array.from({ length: 20 }, () => 0xab));
        data.set(Uint8Array.from({ length: 32 }, () => 0xcd), 32);
        expect(reportDataBinds(data, key, nonce)).to.deep.equal({ key: true, nonce: true });
        expect(reportDataBinds(data, 'ab'.repeat(21), nonce).key).to.be.false;
    });
});

describe('a report from another confidential-computing provider', function () {
    it('is reported as a format this page cannot check, not as a failed quote', async () => {
        const report = { gateway_attestation: null, model_attestations: [{ provider: 'chutes', model: 'moonshotai/kimi-k3', quote_b64: 'BAAC', nonce: 'aa'.repeat(32), e2e_pubkey: 'x' }] };
        const result = await verifyModel('moonshotai/kimi-k3', { nonce: 'aa'.repeat(32), fetchFn: async () => new Response(JSON.stringify(report)) });
        expect(result.verified).to.be.false;
        expect(result.signingKey).to.equal(null);
        expect(result.checks.map((c) => c.id)).to.deep.equal(['report', 'format']);
        expect(result.checks[1]).to.include({ unsupported: true, provider: 'chutes' });
    });
});
