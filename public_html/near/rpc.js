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

/**
 * Fetch ft_metadata from a fungible token contract
 * @param {string} contractId - The fungible token contract ID
 * @returns {Promise<{spec: string, name: string, symbol: string, decimals: number, icon?: string}|null>}
 */
export async function fetchFtMetadata(contractId) {
    try {
        const result = await queryMultipleRPC(async (rpcUrl) => {
            return fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'ft-metadata',
                    method: 'query',
                    params: {
                        request_type: 'call_function',
                        finality: 'final',
                        account_id: contractId,
                        method_name: 'ft_metadata',
                        args_base64: btoa('{}')
                    }
                })
            });
        });

        if (result?.result?.result) {
            const bytes = new Uint8Array(result.result.result);
            const jsonStr = new TextDecoder().decode(bytes);
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        console.warn(`Error fetching ft_metadata for ${contractId}:`, e);
        return null;
    }
}
