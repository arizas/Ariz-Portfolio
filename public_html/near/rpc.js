export const rpcUrl = 'https://rpc.mainnet.fastnear.com/';

// Export rpcs array for backwards compatibility with test runner
export const rpcs = [rpcUrl];

export async function queryMultipleRPC(queryFunction) {
    const response = await queryFunction(rpcUrl);
    return await response.json();
}

/**
 * Call a contract view function via JSON-RPC and return the decoded JSON result.
 * @param {string} contractId
 * @param {string} methodName
 * @param {object} [args]
 * @returns {Promise<any>} the parsed return value (null if the method returned nothing)
 */
export async function callViewFunction(contractId, methodName, args = {}) {
    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'view',
            method: 'query',
            params: {
                request_type: 'call_function',
                finality: 'final',
                account_id: contractId,
                method_name: methodName,
                args_base64: btoa(JSON.stringify(args))
            }
        })
    });
    const result = await response.json();
    if (result.error) {
        throw new Error(result.error.data || result.error.message || JSON.stringify(result.error));
    }
    if (result?.result?.result) {
        return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result.result)));
    }
    return null;
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
