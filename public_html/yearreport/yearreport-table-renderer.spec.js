import { fetchNEARHistoricalPrices } from '../pricedata/pricedata.js';
import { fetchTransactionsForAccount, setAccounts } from '../storage/domainobjectstore.js';
import './yearreport-print.component.js';
import { renderYearReportTable } from "./yearreport-table-renderer.js";

describe('year-report-table-renderer', () => {
    it('should render table for year report', async function () {
        const account = 'psalomo.near';
        const startDate = new Date(2021, 4, 1);
        await setAccounts([account]);
        await fetchNEARHistoricalPrices();

        await fetchTransactionsForAccount(account, startDate.getTime() * 1_000_000);

        const yearReportPrintComponent = document.createElement('year-report-print');

        const result = await renderYearReportTable({
            shadowRoot: yearReportPrintComponent.getRootNode().shadowRoot,
            token: '',
            year: 2021,
            convertToCurrency: 'USD',

            perRowFunction: async ({
                row
            }) => {

            }
        });
        expect(result.totalReceived).to.be.closeTo(720.83, 0.01);
        expect(result.inboundBalance.convertedTotalBalance).to.be.closeTo(11.14, 0.01);
        expect(result.outboundBalance.convertedTotalBalance).to.be.closeTo(243.29, 0.01);
        expect(result.totalProfit).to.be.closeTo(69.63, 0.01);
        expect(result.totalLoss).to.be.closeTo(27.46, 0.01);
    });
});