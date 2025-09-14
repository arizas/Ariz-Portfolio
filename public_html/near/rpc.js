import { NearRpcClient, viewAccount as nearViewAccount, tx } from 'https://unpkg.com/@near-js/jsonrpc-client@latest/dist/browser-standalone.min.js';
import { getAccessToken } from '../arizgateway/arizgatewayaccess.js';

let rpcIndex = 0;

// Initialize RPC clients  
// Note: The proxy client will get its authorization header dynamically
let proxyClient = null;
const fastnearClient = new NearRpcClient('https://rpc.mainnet.fastnear.com/');
const archivalClient = new NearRpcClient('https://archival-rpc.mainnet.fastnear.com/');

// Initialize or get the proxy client with current access token
async function getProxyClient() {
    const accessToken = await getAccessToken();
    // Recreate client with new token if needed
    proxyClient = new NearRpcClient({
        endpoint: 'https://near-rpc-proxy-production.arizportfolio.workers.dev', 
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    return proxyClient;
}

export const rpcs = [
    'https://near-rpc-proxy-production.arizportfolio.workers.dev',
    'https://rpc.mainnet.fastnear.com/',
    'https://archival-rpc.mainnet.fastnear.com/'
];

// Get list of RPC clients, initializing proxy client if needed
async function getRpcClients() {
    if (!proxyClient) {
        await getProxyClient();
    }
    return [proxyClient, fastnearClient, archivalClient];
}

// Reusable function to query multiple RPC clients with fallback
async function queryWithFallback(queryFn, methodName = 'query') {
    let result;
    let lastError;
    const rpcClients = await getRpcClients();
    
    for (let n = 0; n < rpcClients.length; n++) {
        const clientIndex = (n + rpcIndex) % rpcClients.length;
        const client = rpcClients[clientIndex];
        try {
            result = await queryFn(client);
            
            if (result && !result.error) {
                rpcIndex++;
                return result;
            }
            lastError = result?.error || 'Unknown error';
        } catch (e) {
            console.error(`${methodName} failed for client ${clientIndex} (${rpcs[clientIndex]}):`, e);
            lastError = e;
        }
    }
    
    rpcIndex++;
    if (lastError) {
        throw lastError;
    }
    return result;
}

// View account querying multiple RPC clients with fallback
export async function viewAccount(account_id, block_id) {
    return queryWithFallback(async (client) => {
        if (block_id === 'final') {
            return await nearViewAccount(client, {
                accountId: account_id,
                finality: 'final'
            });
        } else {
            return await nearViewAccount(client, {
                accountId: account_id,
                blockId: block_id
            });
        }
    }, 'viewAccount');
}

// Get transaction with receipts querying multiple RPC clients with fallback
export async function getTransactionStatusWithReceipts(tx_hash, sender_account_id) {
    return queryWithFallback(async (client) => {
        return await tx(client, {
            txHash: tx_hash,
            senderAccountId: sender_account_id,
            waitUntil: 'NONE'
        });
    }, 'getTransactionStatusWithReceipts');
}

// Legacy support for queryMultipleRPC
export async function queryMultipleRPC(queryFunction) {
    // If it's a function that takes a client, use the new approach
    if (typeof queryFunction === 'function' && queryFunction.length === 1) {
        return queryWithFallback(queryFunction, 'queryMultipleRPC');
    }
    
    // Fallback for legacy fetch-based queries
    let resultObj;
    for (let n = 0; n < rpcs.length; n++) {
        const rpcUrl = rpcs[(n + rpcIndex) % rpcs.length];
        try {
            const response = await queryFunction(rpcUrl);
            resultObj = await response.json();

            if (resultObj && !resultObj.error) {
                break;
            }
        } catch (e) {
            console.error(`Legacy query failed for ${rpcUrl}:`, e);
        }
    }
    rpcIndex++;
    return resultObj;
}

// Export clients for direct use
export { getProxyClient, fastnearClient, archivalClient, getRpcClients, nearViewAccount, tx };