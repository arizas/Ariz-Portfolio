import './accesskeys-page.component.js';
import { setAccounts, getAccessKeys, setAccessKeyNotes, refreshAccessKeys, writeTransactions, writeFungibleTokenTransactions } from '../storage/domainobjectstore.js';
import { archivalRpcUrl } from '../near/accesskeys.js';
import { __setTestWallet } from '../arizgateway/arizgatewayaccess.js';
import { rpcUrl } from '../near/rpc.js';

const ACCOUNT = 'accesskeys-test.near';

describe('accesskeys-page.component', () => {
    let realFetch;
    let chainKeys;
    let blockLookup = Promise.resolve();
    let chainTransactions = {};
    const lookedUp = [];

    // The chain as this test wants it: the key list from the RPC, and a fixed
    // time for every block.
    before(async () => {
        realFetch = window.fetch;
        window.fetch = async (url, options) => {
            if (url === rpcUrl && JSON.parse(options.body).params?.request_type === 'view_access_key_list') {
                return new Response(JSON.stringify({ jsonrpc: '2.0', result: { block_height: 217499500, keys: chainKeys } }));
            }
            if (url === archivalRpcUrl && JSON.parse(options.body).method === 'block') {
                await blockLookup;
                return new Response(JSON.stringify({ jsonrpc: '2.0', result: { header: { timestamp_nanosec: '1713502111587973394' } } }));
            }
            if (url === archivalRpcUrl && JSON.parse(options.body).method === 'tx') {
                const { tx_hash } = JSON.parse(options.body).params;
                lookedUp.push(tx_hash);
                const transaction = chainTransactions[tx_hash];
                return new Response(JSON.stringify(transaction
                    ? { jsonrpc: '2.0', result: { transaction } }
                    : { jsonrpc: '2.0', error: { cause: { name: 'UNKNOWN_TRANSACTION' }, data: `Transaction ${tx_hash} doesn't exist` } }));
            }
            return realFetch(url, options);
        };
        await setAccounts([ACCOUNT]);
    });
    after(() => {
        window.fetch = realFetch;
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

    it('finds the last use of each key in the fetched history', async () => {
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
            await writeTransactions(ACCOUNT, [
                { hash: 'OWN', block_timestamp: ns('2026-05-02T10:00:00.000Z'), signer_id: ACCOUNT, args: {} },
                { hash: 'INCOMING', block_timestamp: ns('2026-04-01T10:00:00.000Z'), signer_id: 'friend.near', args: {} }
            ]);
            // A relayed token transfer moves no NEAR: it is only among the token transactions.
            await writeFungibleTokenTransactions(ACCOUNT, [{
                transaction_hash: 'RELAYED', block_timestamp: ns('2026-06-03T10:00:00.000Z'),
                ft: { contract_id: 'usdc.near', symbol: 'USDC' }
            }]);
            chainTransactions = {
                RELAYED: {
                    signer_id: 'relayer.nearmobile.near', public_key: 'ed25519:RELAYER', nonce: 9,
                    actions: [{ Delegate: { delegate_action: { sender_id: ACCOUNT, public_key: 'ed25519:FULL', nonce: 117149950000043 } } }]
                },
                OWN: { signer_id: ACCOUNT, public_key: 'ed25519:LEDGER', nonce: 117149960000004, actions: [] },
                INCOMING: { signer_id: 'friend.near', public_key: 'ed25519:FRIEND', nonce: 1, actions: [] }
            };
            lookedUp.length = 0;
            await page.findLastUses();

            expect(lookedUp).to.deep.equal(['RELAYED', 'OWN']);
            const cell = (publicKey) => [...shadowRoot.querySelectorAll('#keystable tr')]
                .find(row => row.querySelector('.publickey').title === publicKey).querySelector('.keylastused');
            expect(cell('ed25519:FULL').textContent).to.equal('2026-06-03via relayer.nearmobile.near');
            expect(cell('ed25519:LEDGER').textContent).to.equal('After 2026-05-02 (1 newer signature not in the fetched history)');
            expect(shadowRoot.querySelector('#lastusestatus').textContent).to.equal('Looked up 2 transactions.');
            // The note from the first test is still there.
            expect((await getAccessKeys(ACCOUNT)).keys['ed25519:FULL'].notes.label).to.equal('Meteor on phone');

            // Nothing new to look up the second time.
            lookedUp.length = 0;
            await page.findLastUses();
            expect(lookedUp).to.deep.equal([]);
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
