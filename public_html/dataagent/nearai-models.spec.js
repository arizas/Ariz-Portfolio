import { fetchChatModels, privacyStatement } from './nearai-models.js';

const MODEL = { id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', name: 'DeepSeek V4.1 Flash 1017' };
const ok = (id, label) => ({ id, ok: true, label });

describe('choosing a NEAR AI model', function () {
    it('lists every chat model NEAR AI offers, private or not, and no embedding or audio model', async () => {
        const fetchFn = async () => new Response(JSON.stringify({ data: [
            { id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', architecture: { outputModalities: ['text'] } },
            { id: MODEL.id, name: MODEL.name, architecture: { outputModalities: ['text'] } },
            { id: 'Qwen/Qwen3-Embedding-0.6B', name: 'Qwen3-Embedding-0.6B' },
            { id: 'openai/whisper-large-v3', name: 'Whisper Large v3' },
            { id: 'black-forest-labs/FLUX.2-klein-4B', name: 'FLUX.2-klein-4B', architecture: { outputModalities: ['image'] } },
        ] }));
        expect((await fetchChatModels({ fetchFn })).map((m) => m.id)).to.deep.equal(['anthropic/claude-sonnet-5-5', MODEL.id]);
    });

    it('says private only when every required check passed', () => {
        const statement = privacyStatement(MODEL, { verified: true, checks: [ok('report'), ok('model-quote')] });
        expect(statement.kind).to.equal('private');
        expect(statement.text).to.match(/^Private\. DeepSeek V4\.1 Flash 1017 runs in confidential hardware that this browser verified/);
        expect(statement.acknowledge).to.equal(undefined);
    });

    it('says not private, and why, for a model NEAR AI cannot attest, and asks the owner to accept it', () => {
        const claude = { id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5' };
        const statement = privacyStatement(claude, { verified: false, checks: [{ id: 'report', ok: false, label: 'report', detail: 'TEE attestation is not supported for external providers' }] });
        expect(statement.kind).to.equal('not-private');
        expect(statement.text).to.equal('Not private. NEAR AI could not show that Claude Sonnet 5.5 runs in confidential hardware (it said: "TEE attestation is not supported for external providers"). '
            + 'Your questions, and whatever the assistant reads from your store or its scripts print, go unencrypted to NEAR AI and to the company that runs the model, who can read them.');
        expect(statement.acknowledge).to.equal('I understand, and accept this for Claude Sonnet 5.5');
    });

    it('names the check that failed for a model that should be private', () => {
        const statement = privacyStatement(MODEL, { verified: false, checks: [
            ok('report', 'report'),
            ok('model-quote', 'Intel signed the model enclave\'s report'),
            { id: 'gpu', ok: false, label: 'NVIDIA attests the GPUs are in confidential mode', detail: 'NVIDIA\'s verdict has expired' },
            { id: 'gateway', ok: false, informational: true, label: 'gateway' },
        ] });
        expect(statement.kind).to.equal('failed');
        expect(statement.text).to.match(/^Not verified\. DeepSeek V4\.1 Flash 1017 should run in confidential hardware, but a check failed: NVIDIA attests the GPUs are in confidential mode: NVIDIA's verdict has expired\. Until it passes, it is not private\./);
        expect(statement.acknowledge).to.equal('I understand, and accept this for DeepSeek V4.1 Flash 1017');
    });

    it('says it is checking while the check runs', () => {
        expect(privacyStatement(MODEL, null)).to.deep.equal({ kind: 'checking', text: 'Checking that DeepSeek V4.1 Flash 1017 runs in confidential hardware…' });
    });
});

describe('a model at another confidential-computing provider', function () {
    it('is not called failed: the page says it cannot check that provider yet', () => {
        const kimi = { id: 'moonshotai/kimi-k3', name: 'Kimi K3' };
        const statement = privacyStatement(kimi, { verified: false, checks: [
            { id: 'report', ok: true, label: 'report' },
            { id: 'format', ok: false, unsupported: true, provider: 'chutes', label: 'format', detail: 'the model runs at chutes' },
        ] });
        expect(statement.kind).to.equal('unsupported');
        expect(statement.text).to.match(/^Not verified\. NEAR AI runs Kimi K3 at Chutes, in confidential hardware by NEAR AI's account, but this page cannot check Chutes's attestation yet, so it cannot encrypt to it either\./);
        expect(statement.acknowledge).to.equal('I understand, and accept this for Kimi K3');
    });
});
