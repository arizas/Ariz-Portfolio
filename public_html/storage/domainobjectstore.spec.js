import { getCustomExchangeRatesAsTable, setCustomExchangeRatesFromTable, getHistoricalPriceData, setHistoricalPriceData, getAllFungibleTokenTransactions, fetchFungibleTokenTransactionsForAccount, getTransactionsForAccount } from './domainobjectstore.js';

describe('domainobjectstore', () => {
    it('should get and set custom exchange rates from table', async function () {
        const customexchangeratestable = [
            {
                date: '2022-04-14',
                currency: 'nok',
                price: 20.3,
                buysell: 'buy'
            },
            {
                date: '2022-06-12',
                currency: 'nok',
                price: 13.3,
                buysell: 'sell'
            }
        ];
        await setCustomExchangeRatesFromTable(customexchangeratestable);
        const restoredcustomexchangeratestable = await getCustomExchangeRatesAsTable();
        expect(restoredcustomexchangeratestable).to.deep.equal(customexchangeratestable);
    });
    it('should get and set pricedata', async () => {
        const pricedata = await getHistoricalPriceData('NEAR', 'USD');
        pricedata['2024-01-01'] = 13.3;
        await setHistoricalPriceData('NEAR', 'USD', pricedata);
        expect(await getHistoricalPriceData('NEAR', 'USD')).to.deep.equal(pricedata);
    });
    it('should get all fungible token transactions', async () => {
        const accountId = 'petersalomonsen.near';
        let transactions = await getAllFungibleTokenTransactions(accountId);
        expect(transactions.length).to.equal(0);
        transactions = await fetchFungibleTokenTransactionsForAccount(accountId);
        expect(transactions.length).to.equal(176);
        transactions = await getAllFungibleTokenTransactions(accountId);
        expect(transactions.length).to.equal(176);
        transactions = await getTransactionsForAccount(accountId, 'USDC');
        expect(transactions.length).to.equal(16);
        expect(transactions.reduce((p, c) => BigInt(c.delta_amount) + p, 0n)).to.equal(4563n);
    });
});