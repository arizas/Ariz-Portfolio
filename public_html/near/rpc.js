let rpcIndex = 0;

export const rpcs = [
    'https://free.rpc.fastnear.com',
    'https://rpc.mainnet.near.org',
    'https://1rpc.io/near',
    'https://near.lava.build',
    'https://archival-rpc.mainnet.near.org',
    'https://archival-rpc.mainnet.pagoda.co'
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
