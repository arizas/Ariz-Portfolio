import { mockArizGatewayAccess, mockWalletAuthenticationData } from '../arizgateway/arizgatewayaccess.spec.js';
import { fetchHistoricalPricesFromArizGateway } from '../pricedata/pricedata.js';
import { fetchTransactionsForAccount, setAccounts, setDepositAccounts } from '../storage/domainobjectstore.js';
import './yearreport-print.component.js';
import { renderYearReportTable } from "./yearreport-table-renderer.js";

describe('year-report-table-renderer', () => {
    it('should render table for year report', async function () {
        this.timeout(2 * 60000);
        const account = 'psalomo.near';
        const startDate = new Date(2021, 4, 1);
        await setAccounts([account]);
        await setDepositAccounts({ "af5a8fddfcceacb573d1dd0eba0406934da7dff9b63cebd7eb24ee47f9c3978f": "For creating psalomo.near" });
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: "USD", todate: '2024-05-30' });

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
        expect(result.inboundBalance.convertedTotalBalance).to.be.closeTo(11.14, 0.01);
        expect(result.outboundBalance.convertedTotalBalance).to.be.closeTo(243.29, 0.01);
        expect(result.totalReceived).to.be.closeTo(779.63, 0.01);
        expect(result.totalProfit).to.be.closeTo(75.86, 0.01);
        expect(result.totalLoss).to.be.closeTo(24.32, 0.01);
    });
});