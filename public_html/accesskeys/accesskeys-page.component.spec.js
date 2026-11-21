import './accesskeys-page.component.js';
import { setAccounts, getAccessKeys, setAccessKeyNotes, refreshAccessKeys } from '../storage/domainobjectstore.js';
import { __setTestWallet, arizgatewayhost, ACCESS_TOKEN_SESSION_STORAGE_KEY } from '../arizgateway/arizgatewayaccess.js';

const ACCOUNT = 'accesskeys-test.near';

describe('accesskeys-page.component', () => {
    let realFetch;
    // The keys as the chain has them (RPC shape); the mocked gateway answers with them.
    let chainKeys;
    let blockLookup = Promise.resolve();
    // What the gateway's last-use search answers, one response per request.
    let lastUseAnswers = [];
    const gatewayCalls = [];

    const asGatewayKey = ({ public_key, access_key }) => {
        const start = Math.floor(access_key.nonce / 1_000_000);
        const known = start >= 9_820_210;
        const permission = access_key.permission === 'FullAccess' ? { type: 'FullAccess' } : {
            type: 'FunctionCall', receiverId: access_key.permission.FunctionCall.receiver_id,
            methodNames: access_key.permission.FunctionCall.method_names, allowance: access_key.permission.FunctionCall.allowance
        };
        return {
            publicKey: public_key, nonce: access_key.nonce, permission,
            addedBlock: known ? start + 1 : null, addedAt: known ? '2024-04-19T04:48:31.587Z' : null,
            transactionsSigned: known ? access_key.nonce % 1_000_000 : access_key.nonce,
            lastUse: null, lastUseNotIndexed: false
        };
    };

    // The gateway as this test wants it, signed in.
    before(async () => {
        localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY,
            JSON.stringify({ token: 'test-token', accountId: ACCOUNT, issuedAt: Date.now() }));
        realFetch = window.fetch;
        window.fetch = async (url, options) => {
            const prefix = `${arizgatewayhost}/api/accesskeys/`;
            if (!String(url).startsWith(prefix)) {
                return realFetch(url, options);
            }
            const path = String(url).substring(prefix.length);
            gatewayCalls.push({ path, method: options.method ?? 'GET' });
            if (path === ACCOUNT) {
                await blockLookup;
                return new Response(JSON.stringify({ blockHeight: 217499500, keys: chainKeys.map(asGatewayKey) }));
            }
            if (path === `${ACCOUNT}/lastuse` && options.method === 'POST') {
                const { lastUses, complete } = lastUseAnswers.shift();
                return new Response(JSON.stringify({
                    blockHeight: 217499500,
                    keys: chainKeys.map(asGatewayKey).map(k => ({ ...k, lastUse: lastUses[k.publicKey] ?? null })),
                    lastUseSearch: { complete }
                }));
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

    it('asks the gateway to search on until every last use is found', async () => {
        const page = document.createElement('access-keys-page');
        document.documentElement.appendChild(page);
        const shadowRoot = await page.readyPromise;
        try {
            chainKeys = [
                { public_key: 'ed25519:FULL', access_key: { nonce: 117149950000043, permission: 'FullAccess' } },
                { public_key: 'ed25519:LEDGER', access_key: { nonce: 117149960000005, permission: 'FullAccess' } }
            ];
            await page.refresh();
            const full = { nonce: 117149950000043, txHash: 'RELAYED', at: '2026-06-03T10:00:00.000Z', relayer: 'relayer.nearmobile.near' };
            const ledger = { nonce: 117149960000005, txHash: 'OWN', at: '2026-05-02T10:00:00.000Z', relayer: null };
            lastUseAnswers = [
                { lastUses: { 'ed25519:FULL': full }, complete: false },
                { lastUses: { 'ed25519:FULL': full, 'ed25519:LEDGER': ledger }, complete: true }
            ];
            gatewayCalls.length = 0;
            await page.findLastUses();

            expect(gatewayCalls).to.deep.equal([
                { path: `${ACCOUNT}/lastuse`, method: 'POST' },
                { path: `${ACCOUNT}/lastuse`, method: 'POST' }
            ]);
            const cell = (publicKey) => [...shadowRoot.querySelectorAll('#keystable tr')]
                .find(row => row.querySelector('.publickey').title === publicKey).querySelector('.keylastused');
            expect(cell('ed25519:FULL').textContent).to.equal('2026-06-03via relayer.nearmobile.near');
            expect(cell('ed25519:LEDGER').textContent).to.equal('2026-05-02');
            expect(shadowRoot.querySelector('#lastusestatus').textContent).to.equal('The last use of every key that has signed is found.');
            // The note from the first test is still there.
            expect((await getAccessKeys(ACCOUNT)).keys['ed25519:FULL'].notes.label).to.equal('Meteor on phone');
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
