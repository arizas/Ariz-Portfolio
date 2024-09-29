import { mockArizGatewayAccess, mockWalletAuthenticationData } from '../arizgateway/arizgatewayaccess.spec.js';
import { fetchHistoricalPricesFromArizGateway } from '../pricedata/pricedata.js';
import { fetchTransactionsForAccount, setAccounts, setDepositAccounts } from '../storage/domainobjectstore.js';
import './yearreport-print.component.js';
import { calculatePeriodStartAndEndDate, renderPeriodReportTable, renderYearReportTable } from "./yearreport-table-renderer.js";

describe('year-report-table-renderer', () => {
    it('should calculate period start and end date', () => {
        const { periodStartDate, periodEndDate } = calculatePeriodStartAndEndDate(2024, 0, 2);
        expect(periodStartDate.toJSON()).to.equal('2024-01-01T00:00:00.000Z');
        expect(periodEndDate.toJSON()).to.equal('2024-02-29T00:00:00.000Z');
    });

    it('should calculate period start and end date for current year', () => {
        const { periodStartDate, periodEndDate } = calculatePeriodStartAndEndDate(new Date().getFullYear(), 0, 12);
        expect(periodStartDate.toJSON()).to.equal('2024-01-01T00:00:00.000Z');
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        expect(periodEndDate.toJSON()).to.equal(yesterday.toJSON().substring(0, 'yyyy-MM-dd'.length) + 'T00:00:00.000Z');
    });

    it('should render table for year report', async function () {
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

    it('should render table for period report', async function () {
        const account = 'psalomo.near';
        const startDate = new Date(2021, 4, 1);
        await setAccounts([account]);
        await setDepositAccounts({ "af5a8fddfcceacb573d1dd0eba0406934da7dff9b63cebd7eb24ee47f9c3978f": "For creating psalomo.near" });
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: "USD", todate: '2024-05-30' });

        await fetchTransactionsForAccount(account, startDate.getTime() * 1_000_000);

        const yearReportPrintComponent = document.createElement('year-report-print');

        const result = await renderPeriodReportTable({
            shadowRoot: yearReportPrintComponent.getRootNode().shadowRoot,
            token: '',
            periodStartDate: new Date(Date.UTC(2021, 1, 7)),
            periodEndDate: new Date(Date.UTC(2021, 1, 23)),
            convertToCurrency: 'USD',

            perRowFunction: async ({
                row
            }) => {

            }
        });
        expect(result.inboundBalance.convertedTotalBalance).to.be.closeTo(21.47, 0.01);
        expect(result.outboundBalance.convertedTotalBalance).to.be.closeTo(26.23, 0.01);
    });

    it('should render table for period report', async function () {
        const account = 'psalomo.near';
        const startDate = new Date(2021, 4, 1);
        await setAccounts([account]);
        await setDepositAccounts({ "af5a8fddfcceacb573d1dd0eba0406934da7dff9b63cebd7eb24ee47f9c3978f": "For creating psalomo.near" });
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
        await fetchHistoricalPricesFromArizGateway({ baseToken: 'NEAR', currency: "USD", todate: '2024-05-30' });

        await fetchTransactionsForAccount(account, startDate.getTime() * 1_000_000);

        const yearReportPrintComponent = document.createElement('year-report-print');

        const result = await renderPeriodReportTable({
            shadowRoot: yearReportPrintComponent.getRootNode().shadowRoot,
            token: '',
            periodStartDate: new Date(Date.UTC(2021, 1, 7)),
            periodEndDate: new Date(Date.UTC(2021, 1, 23)),
            convertToCurrency: 'USD',

            perRowFunction: async ({
                row
            }) => {

            }
        });
        expect(result.inboundBalance.convertedTotalBalance).to.be.closeTo(21.47, 0.01);
        expect(result.outboundBalance.convertedTotalBalance).to.be.closeTo(26.23, 0.01);
    });
});