import { getCustomExchangeRatesAsTable, setCustomExchangeRatesFromTable } from './domainobjectstore.js';

describe('domainobjectstore', () => {
    it('should get and set custom exchange rates from table', async function() {
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
});