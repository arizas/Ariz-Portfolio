import './accesskeys-page.component.js';
import { setAccounts, getAccessKeys, setAccessKeyNotes, refreshAccessKeys } from '../storage/domainobjectstore.js';
import { __setTestWallet, arizgatewayhost, ACCESS_TOKEN_SESSION_STORAGE_KEY } from '../arizgateway/arizgatewayaccess.js';

const ACCOUNT = 'accesskeys-test.near';

describe('accesskeys-page.component', () => {
    let realFetch;
    let chainKeys;
    let blockLookup = Promise.resolve();
    // FastNear's index of the account's signed transactions, newest first.
    let signedIndex = [];
    const gatewayCalls = [];

    // The gateway as this test wants it, signed in: the key list, a fixed time
    // for every block, and the signed-transaction index.
    before(async () => {
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'test-token', accountId: ACCOUNT, issuedAt: Date.now() }));
        realFetch = window.fetch;
        window.fetch = async (url, options) => {
            const prefix = `${arizgatewayhost}/api/fastnear`;
            if (!String(url).startsWith(prefix)) {
                return realFetch(url, options);
            }
            const path = String(url).substring(prefix.length);
            const body = JSON.parse(options.body);
            gatewayCalls.push({ path, body, authorization: options.headers.authorization });
            const json = (result) => new Response(JSON.stringify(result));
            if (path === '/rpc' && body.params?.request_type === 'view_access_key_list') {
                return json({ jsonrpc: '2.0', result: { block_height: 217499500, keys: chainKeys } });
            }
            if (path === '/archival-rpc' && body.method === 'block') {
                await blockLookup;
                return json({ jsonrpc: '2.0', result: { header: { timestamp_nanosec: '1713502111587973394' } } });
            }
            if (path === '/tx/v0/account') {
                return json({ account_txs: signedIndex.map(({ hash, at }) => ({ transaction_hash: hash, tx_block_timestamp: at })) });
            }
            if (path === '/tx/v0/transactions') {
                return json({ transactions: body.tx_hashes.map(hash => ({ transaction: signedIndex.find(t => t.hash === hash).transaction })) });
            }
            return new Response('not mocked', { status: 500 });
        };
        await setAccounts([ACCOUNT]);
    });
    after(() => {
        window.fetch = realFetch;
        localStorage.removeItem(ACCESS_TOKEN_SESSION_STORAGE_KEY);
    });

    it('keeps a note saved while a refresh was in flight', async () => {
        chainKeys = [{ public_key: 'ed25519:FULL', access_key: { nonce: 117149950000039, permission: 'FullAccess' } }];
        // The refresh has read the file and is waiting on the block date when
        // the note is saved.
        let releaseBlockLookup;
        blockLookup = new Promise(resolve => releaseBlockLookup = resolve);
        const refreshing = refreshAccessKeys(ACCOUNT);
        await new Promise(resolve => setTimeout(resolve, 50));
        await setAccessKeyNotes(ACCOUNT, 'ed25519:FULL', { label: 'Meteor on phone' });
        releaseBlockLookup();
        await refreshing;
        const stored = await getAccessKeys(ACCOUNT);
        expect(stored.keys['ed25519:FULL'].notes.label).to.equal('Meteor on phone');
        expect(stored.keys['ed25519:FULL'].observed.addedAt).to.equal('2024-04-19T04:48:31.587Z');
    });

    it('lists the keys, saves notes and shows a removed key as removed', async () => {
        const page = document.createElement('access-keys-page');
        document.documentElement.appendChild(page);
        const shadowRoot = await page.readyPromise;
        try {
            chainKeys = [
                { public_key: 'ed25519:FULL', access_key: { nonce: 117149950000041, permission: 'FullAccess' } },
                {
                    public_key: 'ed25519:APP', access_key: {
                        nonce: 168955707000000,
                        permission: { FunctionCall: { allowance: '250000000000000000000000', method_names: [], receiver_id: 'arizportfolio.near' } }
                    }
                },
                { public_key: 'ed25519:GONE', access_key: { nonce: 117179934000061, permission: 'FullAccess' } }
            ];
            await page.refresh();
            chainKeys = chainKeys.slice(0, 2);
            await page.refresh();

            const rows = [...shadowRoot.querySelectorAll('#keystable tr')];
            expect(rows.map(row => row.querySelector('.publickey').title))
                .to.deep.equal(['ed25519:FULL', 'ed25519:APP', 'ed25519:GONE']);
            expect(rows[0].querySelector('.keyaccess').textContent).to.equal('Full access');
            expect(rows[0].querySelector('.keylabel').value).to.equal('Meteor on phone');
            expect(rows[0].querySelector('.keysigned').textContent).to.equal('41');
            expect(rows[0].querySelector('.keylastused').textContent).to.match(/^Between \d{4}-\d{2}-\d{2} and \d{4}-\d{2}-\d{2}$/);
            expect(rows[1].querySelector('.keyaccess').textContent)
                .to.equal('Function callarizportfolio.near · any method · 0.2500 NEAR fee allowance');
            expect(rows[1].querySelector('.keylastused').textContent).to.equal('Never');
            expect(rows[2].classList.contains('deleted')).to.equal(true);
            expect(rows[2].querySelector('.keylastused').textContent).to.match(/^Removed between /);
            expect(shadowRoot.querySelector('#summary').textContent)
                .to.equal('1 full access and 1 function call keys.');

            const text = rows[1].querySelector('.keytext');
            text.value = 'Ariz Portfolio sign-in';
            text.dispatchEvent(new Event('change'));
            await new Promise(resolve => setTimeout(resolve, 50));
            expect((await getAccessKeys(ACCOUNT)).keys['ed25519:APP'].notes.text).to.equal('Ariz Portfolio sign-in');
        } finally {
            page.remove();
        }
    });

    it('finds the last use of each key through the gateway', async () => {
        const page = document.createElement('access-keys-page');
        document.documentElement.appendChild(page);
        const shadowRoot = await page.readyPromise;
        try {
            const ns = (iso) => (BigInt(Date.parse(iso)) * 1_000_000n).toString();
            chainKeys = [
                { public_key: 'ed25519:FULL', access_key: { nonce: 117149950000043, permission: 'FullAccess' } },
                { public_key: 'ed25519:LEDGER', access_key: { nonce: 117149960000005, permission: 'FullAccess' } }
            ];
            await page.refresh();
            signedIndex = [
                {
                    hash: 'RELAYED', at: ns('2026-06-03T10:00:00.000Z'), transaction: {
                        hash: 'RELAYED', signer_id: 'relayer.nearmobile.near', public_key: 'ed25519:RELAYER', nonce: 9,
                        actions: [{ Delegate: { delegate_action: { sender_id: ACCOUNT, public_key: 'ed25519:FULL', nonce: 117149950000043 } } }]
                    }
                },
                {
                    hash: 'OWN', at: ns('2026-05-02T10:00:00.000Z'), transaction: {
                        hash: 'OWN', signer_id: ACCOUNT, public_key: 'ed25519:LEDGER', nonce: 117149960000005, actions: []
                    }
                }
            ];
            gatewayCalls.length = 0;
            await page.findLastUses();

            expect(gatewayCalls.map(c => c.path)).to.deep.equal(['/tx/v0/account', '/tx/v0/transactions']);
            expect(gatewayCalls[0].body).to.deep.equal({ account_id: ACCOUNT, is_any_signer: true, limit: 200 });
            expect(gatewayCalls[1].body).to.deep.equal({ tx_hashes: ['RELAYED', 'OWN'] });
            expect(gatewayCalls[0].authorization).to.equal('Bearer test-token');
            const cell = (publicKey) => [...shadowRoot.querySelectorAll('#keystable tr')]
                .find(row => row.querySelector('.publickey').title === publicKey).querySelector('.keylastused');
            expect(cell('ed25519:FULL').textContent).to.equal('2026-06-03via relayer.nearmobile.near');
            expect(cell('ed25519:LEDGER').textContent).to.equal('2026-05-02');
            expect(shadowRoot.querySelector('#lastusestatus').textContent).to.equal('Looked through the newest 200 signed transactions.');
            // The note from the first test is still there.
            expect((await getAccessKeys(ACCOUNT)).keys['ed25519:FULL'].notes.label).to.equal('Meteor on phone');

            // No key has signed since: nothing to look up the second time.
            gatewayCalls.length = 0;
            await page.findLastUses();
            expect(gatewayCalls).to.deep.equal([]);
            expect(shadowRoot.querySelector('#lastusestatus').textContent).to.equal('No key has signed anything since the last search.');
            expect(cell('ed25519:FULL').textContent).to.equal('2026-06-03via relayer.nearmobile.near');
        } finally {
            page.remove();
        }
    });

    describe('removing a key', () => {
        let sent;
        const wallet = (accountId, publicKey) => ({
            accountId,
            async getAccounts() { return [{ accountId, publicKey }]; },
            async signAndSendTransaction(params) {
                sent.push(params);
                // The chain applies it: the key is gone at the next check.
                chainKeys = chainKeys.filter(k => k.public_key !== params.actions[0].params.publicKey);
                return { status: 'ok' };
            }
        });
        // Answer the next modal with the button for `result` and return its text.
        const answerModal = async (result) => {
            let modalElement;
            for (let n = 0; n < 100 && !modalElement; n++) {
                await new Promise(resolve => setTimeout(resolve, 10));
                modalElement = document.querySelector('common-modal');
            }
            const text = modalElement.shadowRoot.textContent;
            modalElement.shadowRoot.querySelector(`[data-result="${result}"]`).click();
            return text;
        };
        let page, shadowRoot;
        const button = (publicKey) => shadowRoot.querySelector(`tr[data-publickey="${publicKey}"] .keydelete`);

        beforeEach(async () => {
            sent = [];
            chainKeys = [
                { public_key: 'ed25519:FULL', access_key: { nonce: 117149950000043, permission: 'FullAccess' } },
                { public_key: 'ed25519:LEDGER', access_key: { nonce: 117149960000005, permission: 'FullAccess' } }
            ];
            page = document.createElement('access-keys-page');
            document.documentElement.appendChild(page);
            shadowRoot = await page.readyPromise;
            await page.refresh();
        });
        afterEach(() => {
            page.remove();
            __setTestWallet(null);
        });

        it('asks for the account itself to sign', async () => {
            __setTestWallet(wallet('someoneelse.near', 'ed25519:X'));
            const deleting = page.deleteKey('ed25519:LEDGER');
            expect(await answerModal('true')).to.contain(`Only ${ACCOUNT} can remove its own keys`);
            await deleting;
            expect(sent).to.deep.equal([]);
        });

        it('sends a DeleteKey once confirmed, warning when it is the wallet\'s own key', async () => {
            __setTestWallet(wallet(ACCOUNT, 'ed25519:LEDGER'));
            button('ed25519:LEDGER').click();
            const question = await answerModal('true');
            expect(question).to.contain('This is the key the connected wallet signs with');
            expect(question).to.contain('Where: no note');
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(sent).to.deep.equal([{ receiverId: ACCOUNT, actions: [{ type: 'DeleteKey', params: { publicKey: 'ed25519:LEDGER' } }] }]);
            expect(shadowRoot.querySelector('tr[data-publickey="ed25519:LEDGER"]').classList.contains('deleted')).to.equal(true);
            // FULL is now the only full access key.
            expect(button('ed25519:FULL').disabled).to.equal(true);
            expect(button('ed25519:LEDGER')).to.equal(null);
        });

        it('sends nothing when the answer is no, or when the chain has only one full access key left', async () => {
            __setTestWallet(wallet(ACCOUNT, null));
            const declined = page.deleteKey('ed25519:LEDGER');
            expect(await answerModal('false')).to.not.contain('connected wallet signs with');
            await declined;

            // Removed elsewhere since the page was drawn.
            chainKeys = chainKeys.slice(0, 1);
            const lastOne = page.deleteKey('ed25519:FULL');
            expect(await answerModal('true')).to.contain('last full access key');
            await lastOne;
            expect(sent).to.deep.equal([]);
        });
    });
});
