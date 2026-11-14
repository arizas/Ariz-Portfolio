import { isTransientFailure, runAgentTurn } from './agent.js';

const answer = (content) => new Response(JSON.stringify({ id: 'c1', choices: [{ message: { role: 'assistant', content } }] }));
const failing = (status, message) => new Response(JSON.stringify({ error: { message } }), { status });

async function ask(replies, options = {}) {
    const calls = [];
    const retries = [];
    const fetchFn = async (url, init) => {
        calls.push(init.body);
        const next = replies.shift();
        if (next instanceof Error) throw next;
        return next;
    };
    const result = await runAgentTurn({
        session: { api: {} }, apiKey: 'k', userMessage: 'hi', fetchFn, retryDelayMs: 0,
        onRetry: (failure) => retries.push(failure), ...options,
    }).catch((error) => ({ error }));
    return { ...result, calls, retries };
}

describe('the model call', () => {
    it('sends the same request again once when the provider failed', async () => {
        const out = await ask([failing(400, "Provider failed for model 'm': Upstream request failed"), answer('done')]);
        expect(out.answer).to.equal('done');
        expect(out.calls.length).to.equal(2);
        expect(out.calls[1]).to.equal(out.calls[0]);
        expect(out.retries).to.deep.equal(['NEAR AI answered 400']);
    });

    it('sends it again after a dropped connection or a 5xx', async () => {
        expect((await ask([new TypeError('Failed to fetch'), answer('a')])).answer).to.equal('a');
        expect((await ask([failing(502, 'bad gateway'), answer('b')])).answer).to.equal('b');
    });

    it('gives up after the second failure, and says why', async () => {
        const out = await ask([failing(503, 'busy'), failing(400, 'Upstream request failed')]);
        expect(out.calls.length).to.equal(2);
        expect(out.error.message).to.equal('NEAR AI answered 400: Upstream request failed');
    });

    it('does not repeat a request NEAR AI refused, or one the owner stopped', async () => {
        const refused = await ask([failing(401, 'invalid key'), answer('never')]);
        expect(refused.calls.length).to.equal(1);
        expect(refused.error.message).to.equal('NEAR AI answered 401: invalid key');
        const stopped = await ask([Object.assign(new Error('stopped'), { name: 'AbortError' }), answer('never')]);
        expect(stopped.calls.length).to.equal(1);
        expect(stopped.error.name).to.equal('AbortError');
    });

    it('treats only the provider\'s failures as worth another try', () => {
        expect(isTransientFailure(400, '{"error":{"message":"Provider failed for model x: Upstream request failed"}}')).to.equal(true);
        expect(isTransientFailure(504)).to.equal(true);
        expect(isTransientFailure(400, 'messages: invalid')).to.equal(false);
        expect(isTransientFailure(429, 'rate limited')).to.equal(false);
    });
});
