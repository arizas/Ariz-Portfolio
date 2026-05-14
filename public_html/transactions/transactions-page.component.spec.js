import './transactions-page.component.js';
import { setAccounts, writeAccountingRecords } from '../storage/domainobjectstore.js';

describe('transactions-page', () => {
    const account = 'test.near';
    let component;
    let shadowRoot;

    before(async () => {
        await setAccounts([account]);
        await writeAccountingRecords(account, {
            version: 2,
            accountId: account,
            metadata: { firstBlock: 100, lastBlock: 103, totalRecords: 5, historyComplete: true },
            records: [
                {
                    block_height: 100,
                    block_timestamp: '2026-01-01T10:00:00.000Z',
                    token_id: 'near',
                    amount: '5000000000000000000000000', // +5 NEAR
                    balance_before: '0',
                    balance_after: '5000000000000000000000000',
                    counterparty: 'sender.near',
                    tx_hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'
                },
                {
                    block_height: 101,
                    block_timestamp: '2026-01-02T10:00:00.000Z',
                    token_id: 'arizcredits.near',
                    amount: '1000000', // +1 ARIZ (6 decimals)
                    balance_before: '0',
                    balance_after: '1000000',
                    counterparty: 'arizcredits.near',
                    tx_hash: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2'
                },
                {
                    block_height: 102,
                    block_timestamp: '2026-01-03T10:00:00.000Z',
                    token_id: 'nep141:btc.omft.near',
                    amount: '50000', // +0.0005 BTC (8 decimals)
                    balance_before: '0',
                    balance_after: '50000',
                    counterparty: 'solver-ref.near',
                    tx_hash: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC3'
                },
                {
                    block_height: 102,
                    block_timestamp: '2026-01-03T10:00:00.000Z',
                    token_id: 'astro-stakers.poolv1.near',
                    amount: '10000000000000000000000000', // +10 NEAR staked
                    balance_before: '0',
                    balance_after: '10000000000000000000000000',
                    counterparty: 'astro-stakers.poolv1.near',
                    tx_hash: null
                },
                {
                    // Zero-amount balance snapshot — should be filtered out.
                    block_height: 103,
                    block_timestamp: '2026-01-04T10:00:00.000Z',
                    token_id: 'near',
                    amount: '0',
                    balance_before: '5000000000000000000000000',
                    balance_after: '5000000000000000000000000',
                    counterparty: null,
                    tx_hash: null
                }
            ]
        });

        component = document.createElement('transactions-page');
        document.body.appendChild(component);
        shadowRoot = await component.readyPromise;

        const select = shadowRoot.querySelector('#accountselect');
        select.value = account;
        await component.updateView(account);
    });

    after(() => {
        component.remove();
    });

    it('renders one row per balance-changing non-staking record', () => {
        const rows = shadowRoot.querySelectorAll('#transactionstable tr');
        // 5 fixture records → minus 1 staking-pool → minus 1 zero-amount snapshot → 3 rendered
        expect(rows.length).to.equal(3);
    });

    it('orders rows reverse-chronologically (newest block first)', () => {
        const blocks = Array.from(shadowRoot.querySelectorAll('#transactionstable .txrow_block'))
            .map(el => Number(el.textContent));
        // After filters: BTC (block 102), ARIZ (101), NEAR (100). Block 103 is
        // a zero-amount NEAR snapshot — filtered.
        expect(blocks).to.deep.equal([102, 101, 100]);
    });

    it('does not render any staking-pool rows', () => {
        const rawIds = Array.from(shadowRoot.querySelectorAll('#transactionstable .txrow_token_id'))
            .map(el => el.textContent);
        expect(rawIds.some(id => id.includes('.poolv1.near') || id.includes('.pool.near'))).to.equal(false);
    });

    it('does not render zero-amount balance-snapshot rows', () => {
        const changes = Array.from(shadowRoot.querySelectorAll('#transactionstable .txrow_change'))
            .map(el => el.textContent);
        // None of the rendered changes should be exactly "0"
        expect(changes.some(c => c === '0')).to.equal(false);
        // The latest block in the fixture (103) is a zero-amount snapshot —
        // shouldn't appear among the rendered blocks
        const blocks = Array.from(shadowRoot.querySelectorAll('#transactionstable .txrow_block'))
            .map(el => Number(el.textContent));
        expect(blocks.includes(103)).to.equal(false);
    });

    it('shows both the resolved symbol and the raw token_id', () => {
        const symbols = Array.from(shadowRoot.querySelectorAll('#transactionstable .txrow_token_symbol'))
            .map(el => el.textContent);
        const rawIds = Array.from(shadowRoot.querySelectorAll('#transactionstable .txrow_token_id'))
            .map(el => el.textContent);

        expect(symbols).to.include('NEAR');
        expect(rawIds).to.include('near');
        expect(rawIds).to.include('arizcredits.near');
        expect(rawIds).to.include('nep141:btc.omft.near');
    });

    it('formats NEAR amount with 24 decimals (5 NEAR row shows "5")', () => {
        const rows = Array.from(shadowRoot.querySelectorAll('#transactionstable tr'));
        const nearRow = rows.find(r => r.querySelector('.txrow_token_id').textContent === 'near');
        expect(nearRow.querySelector('.txrow_change').textContent).to.equal('5');
        expect(nearRow.querySelector('.txrow_balance').textContent).to.equal('5');
    });

    it('renders tx hash as an explorer link', () => {
        const rows = Array.from(shadowRoot.querySelectorAll('#transactionstable tr'));
        const nearRow = rows.find(r => r.querySelector('.txrow_token_id').textContent === 'near');
        const link = nearRow.querySelector('.txrow_hash a');
        expect(link).to.not.equal(null);
        expect(link.href).to.equal('https://explorer.near.org/transactions/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1');
    });
});
