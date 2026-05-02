import { getBlockData, getBlockInfo, getStakingAccounts } from './stakingpool.js';
import { fetchTransactionsFromAccountingExport, setAccounts } from '../storage/domainobjectstore.js';
import { mockWalletAuthenticationData, mockArizGatewayAccess } from '../arizgateway/arizgatewayaccess.spec.js';

describe('stakingpool', () => {
    before(async function () {
        mockWalletAuthenticationData();
        await mockArizGatewayAccess();
    });

    it('should get latest block data and then get the same block data by block height', async function () {
        const blockdata = await getBlockData('final');
        const refBlockData = await getBlockData(blockdata.header.height);
        expect(blockdata).to.deep.equal(refBlockData);
    });
    it('should get latest block data and then get block info by hash', async function () {
        const blockdata = await getBlockData('final');
        const blockInfo = await getBlockInfo(blockdata.header.hash);
        expect(blockdata.header).to.deep.equal(blockInfo.header);
    });

    it('should fetch staking pool accounts', async function () {
        this.timeout(10 * 60000);
        const accountId = 'psalomo.near';
        await setAccounts([accountId]);
        await fetchTransactionsFromAccountingExport(accountId);
        const stakingAccounts = await getStakingAccounts(accountId);

        for (const stakingAccount of [
            '01node.poolv1.near',
            'nodeasy.poolv1.near',
            'epic.poolv1.near',
            'inotel.poolv1.near',
            'moonlet.poolv1.near',
            'rekt.poolv1.near'
        ]) {
            expect(stakingAccounts).to.contain(stakingAccount);
        }
    });
});
