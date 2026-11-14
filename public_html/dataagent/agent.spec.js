import { isTransientFailure, runAgentTurn, toolMessageContent } from './agent.js';

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

    it('sends a tool result that is a JSON array inside an object, and shows it as it was', async () => {
        const toolCall = new Response(JSON.stringify({ id: 'c0', choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'list_datasets', arguments: '{}' } }] } }] }));
        const shown = [];
        const out = await ask([toolCall, answer('done')], {
            session: { api: { listDatasets: async () => [{ dataset: 'accounts' }] } },
            onToolResult: (name, args, result) => shown.push(result),
        });
        expect(out.answer).to.equal('done');
        const sent = JSON.parse(out.calls[1]).messages.find((m) => m.role === 'tool');
        expect(JSON.parse(sent.content)).to.deep.equal({ result: [{ dataset: 'accounts' }] });
        expect(JSON.parse(shown[0])).to.deep.equal([{ dataset: 'accounts' }]);
    });

    it('leaves every other tool result as it is', () => {
        expect(toolMessageContent(' [1, 2]')).to.equal('{"result":[1,2]}');
        expect(toolMessageContent('[]')).to.equal('{"result":[]}');
        expect(toolMessageContent('{"rows":[1]}')).to.equal('{"rows":[1]}');
        expect(toolMessageContent('[1, 2] and more text')).to.equal('[1, 2] and more text');
        expect(toolMessageContent('ERROR: no such dataset')).to.equal('ERROR: no such dataset');
    });

    it('treats only the provider\'s failures as worth another try', () => {
        expect(isTransientFailure(400, '{"error":{"message":"Provider failed for model x: Upstream request failed"}}')).to.equal(true);
        expect(isTransientFailure(504)).to.equal(true);
        expect(isTransientFailure(400, 'messages: invalid')).to.equal(false);
        expect(isTransientFailure(429, 'rate limited')).to.equal(false);
    });
});
