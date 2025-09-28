let rpcIndex = 0;

export const rpcs = [
    'https://near-rpc-proxy-production.arizportfolio.workers.dev',
    'https://rpc.mainnet.fastnear.com/',
    'https://archival-rpc.mainnet.fastnear.com/'
];

export async function queryMultipleRPC(queryFunction) {
    const queryRPC = async (rpcUrl) => {
        const response = await queryFunction(rpcUrl);
        const resultObj = await response.json();
        return resultObj;
    };
    let resultObj;
    for (let n = 0; n < rpcs.length; n++) {
        const rpcUrl = rpcs[(n + rpcIndex) % rpcs.length];
        try {
            resultObj = await queryRPC(rpcUrl);

            if (resultObj && !resultObj.error) {
                break;
            }
        } catch (e) {

        }
    }
    rpcIndex++;
    return resultObj;
}
