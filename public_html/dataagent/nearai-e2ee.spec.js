import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, sha256Hex } from './nearai-attestation.js';
import {
    createClientKey, decryptFrom, decryptResponseBody, encryptionHeaders, encryptRequestBody, encryptTo, verifyAnswerSignature,
} from './nearai-e2ee.js';

// The enclave is played by a second key: what is encrypted to its public key
// must open with its seed, and nothing readable may be left on the wire.
const SECRET = 'petersalomonsen.near received 2.2893 NEAR from intents.near';

const request = () => ({
    model: 'm',
    messages: [
        { role: 'system', content: 'You answer about the portfolio.' },
        { role: 'user', content: SECRET },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'query_data', arguments: '{"account":"petersalomonsen.near"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '{"rows":[{"amount":"2289313540572618192551919"}]}' },
    ],
    tools: [{ type: 'function', function: { name: 'query_data', description: 'Query a dataset', parameters: { type: 'object', properties: { account: { type: 'string' } } } } }],
    tool_choice: 'auto',
});

describe('end-to-end encryption to a model enclave', function () {
    it('opens with the recipient\'s key, and only with it', async () => {
        const enclave = createClientKey();
        const sealed = await encryptTo(SECRET, enclave.publicKeyHex);
        expect(sealed).to.match(/^[0-9a-f]+$/);
        expect(sealed.length).to.equal(2 * (32 + 24 + new TextEncoder().encode(SECRET).length + 16));
        expect(await decryptFrom(sealed, enclave.seed)).to.equal(SECRET);
        let error = null;
        try { await decryptFrom(sealed, createClientKey().seed); } catch (e) { error = e; }
        expect(error).to.not.equal(null);
    });

    it('leaves no content readable in a request: messages, tools, tool calls, tool results', async () => {
        const enclave = createClientKey();
        const sent = await encryptRequestBody(request(), enclave.publicKeyHex);
        const wire = JSON.stringify(sent);
        for (const text of ['portfolio', 'petersalomonsen', 'query_data', 'Query a dataset', 'account', '2289313540572618192551919']) {
            expect(wire).to.not.contain(text);
        }
        expect(sent.messages.map((m) => m.role)).to.deep.equal(['system', 'user', 'assistant', 'tool']);
        expect(sent.messages[2].content).to.equal(null);
        expect(sent.messages[3].tool_call_id).to.equal('c1');
        expect(sent.tool_choice).to.equal('auto');
        expect(JSON.parse(await decryptFrom(sent.tools[0].function.parameters, enclave.seed))).to.deep.equal(request().tools[0].function.parameters);
        expect(await decryptFrom(sent.messages[2].tool_calls[0].function.arguments, enclave.seed)).to.equal('{"account":"petersalomonsen.near"}');
    });

    it('opens an encrypted answer, tool calls included', async () => {
        const client = createClientKey();
        const answer = {
            id: 'chat-1',
            choices: [{ index: 0, message: {
                role: 'assistant',
                content: await encryptTo('Here is what I found', client.publicKeyHex),
                tool_calls: [{ id: 'c2', type: 'function', function: { name: await encryptTo('balance_check', client.publicKeyHex), arguments: await encryptTo('{}', client.publicKeyHex) } }],
            } }],
        };
        const opened = await decryptResponseBody(answer, client.seed);
        expect(opened.choices[0].message.content).to.equal('Here is what I found');
        expect(opened.choices[0].message.tool_calls[0].function).to.deep.equal({ name: 'balance_check', arguments: '{}' });
        expect(opened.id).to.equal('chat-1');
    });

    it('asks for encryption of every field, pinned to the verified enclave', () => {
        const headers = encryptionHeaders('aa', 'bb');
        expect(headers).to.include({ 'X-Signing-Algo': 'ed25519', 'X-Client-Pub-Key': 'aa', 'X-Model-Pub-Key': 'bb', 'X-Encryption-Version': '2', 'X-Encrypt-All-Fields': 'true' });
    });

    describe('the answer\'s signature', function () {
        const enclaveSeed = ed25519.utils.randomPrivateKey();
        const signingKey = bytesToHex(ed25519.getPublicKey(enclaveSeed));
        const requestBody = '{"model":"m","messages":[]}';
        const responseText = '{"id":"chat-1","choices":[]}';
        const signer = async (text, key = signingKey) => async (url, init) => {
            expect(url).to.contain('/v1/signature/chat-1?model=m&signing_algo=ed25519');
            expect(init.headers.Authorization).to.equal('Bearer k');
            return new Response(JSON.stringify({ text, signing_address: key, signature: bytesToHex(ed25519.sign(new TextEncoder().encode(text), enclaveSeed)), signing_algo: 'ed25519' }));
        };
        const check = async (fetchFn, over = {}) => {
            try {
                await verifyAnswerSignature({ chatId: 'chat-1', model: 'm', requestBody, responseText, signingKey, apiKey: 'k', fetchFn, ...over });
                return null;
            } catch (error) { return error.message; }
        };

        it('holds for exactly the request sent and the answer received', async () => {
            const text = `${await sha256Hex(requestBody)}:${await sha256Hex(responseText)}`;
            expect(await check(await signer(text))).to.equal(null);
            expect(await check(await signer(`m:${text}`))).to.equal(null);
        });

        it('fails for another request, another answer, another key or a bad signature', async () => {
            const text = `${await sha256Hex(requestBody)}:${await sha256Hex(responseText)}`;
            expect(await check(await signer(text), { requestBody: '{}' })).to.match(/different request/);
            expect(await check(await signer(text), { responseText: '{}' })).to.match(/different answer/);
            expect(await check(await signer(text, 'cc'.repeat(32)))).to.match(/other than the verified enclave/);
            const otherKey = bytesToHex(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()));
            expect(await check(await signer(text, otherKey), { signingKey: otherKey })).to.match(/does not verify/);
        });
    });
});
