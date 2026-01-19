export const rpcUrl = 'https://rpc.mainnet.fastnear.com/';

export async function queryMultipleRPC(queryFunction) {
    const response = await queryFunction(rpcUrl);
    return await response.json();
}

/**
 * Fetch ft_metadata from a fungible token contract
 * @param {string} contractId - The fungible token contract ID
 * @returns {Promise<{spec: string, name: string, symbol: string, decimals: number, icon?: string}|null>}
 */
export async function fetchFtMetadata(contractId) {
    try {
        const response = await fetch(rpcUrl, {
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
        const result = await response.json();

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
