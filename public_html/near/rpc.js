// Import from the browser-standalone build
// The library exports various RPC methods we can use
import {
    NearRpcClient,
    viewAccount as nearViewAccount,
    tx,
    status,
    viewFunction
} from '@near-js/jsonrpc-client';
import { getAccessToken } from '../arizgateway/arizgatewayaccess.js';

// Initialize RPC client with authorization
let proxyClient = null;

// Initialize or get the proxy client with current access token
async function getProxyClient() {
    if (!proxyClient) {
        // Check if we're in test mode with TEST_RPC_ENDPOINT
        const testEndpoint = (typeof process !== 'undefined' && process.env?.TEST_RPC_ENDPOINT) || window.TEST_RPC_ENDPOINT;

        if (testEndpoint) {
            // Use test endpoint without authentication
            console.log('Using test RPC endpoint:', testEndpoint);
            proxyClient = new NearRpcClient(testEndpoint);
        } else {
            // Use production endpoint with authentication
            const accessToken = await getAccessToken();
            proxyClient = new NearRpcClient({
                endpoint: 'https://near-rpc-proxy-production.arizportfolio.workers.dev',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
        }
    }
    return proxyClient;
}

// Export viewAccount using the library's viewAccount
export async function viewAccount(accountId, blockId) {
    const client = await getProxyClient();
    const params = {
        accountId,
        finality: blockId === 'final' ? 'final' : undefined,
        blockId: blockId === 'final' ? undefined : blockId
    };

    return await nearViewAccount(client, params);
}

// Call view function with automatic JSON parsing
export async function callViewFunction(contractId, methodName, args, blockId) {
    const client = await getProxyClient();

    // Convert args to base64 if provided
    let argsBase64;
    if (args) {
        const argsString = JSON.stringify(args);
        argsBase64 = btoa(argsString);
    }

    // Use the library's viewFunction method with correct parameter names
    const requestParams = {
        accountId: contractId, // viewFunction expects accountId, not contractId
        methodName: methodName,
        argsBase64: argsBase64,
        finality: blockId === 'final' ? 'final' : undefined,
        blockId: blockId === 'final' ? undefined : blockId
    };

    const result = await viewFunction(client, requestParams);

    // Parse the result if it's a valid UTF-8 string
    if (result?.result) {
        try {
            // Convert Uint8Array to string and parse as JSON
            const resultStr = new TextDecoder().decode(new Uint8Array(result.result));
            return JSON.parse(resultStr);
        } catch (e) {
            // If parsing fails, return the raw result
            return result;
        }
    }

    return result;
}

// Send transaction
export async function sendTransaction(signedTxBase64) {
    const client = await getProxyClient();
    return await tx(client, {
        signedTransactionBase64: signedTxBase64,
        waitUntil: 'NONE'
    });
}

// Simple wrapper to get client and execute function
export async function withClient(fn) {
    const client = await getProxyClient();
    return await fn(client);
}

// Get the RPC endpoint for legacy compatibility
function getEndpoint() {
    // Check if we're in test mode
    const testEndpoint = (typeof process !== 'undefined' && process.env?.TEST_RPC_ENDPOINT) || window.TEST_RPC_ENDPOINT;

    if (testEndpoint) {
        return testEndpoint;
    }

    // Default to the proxy endpoint
    return 'https://near-rpc-proxy-production.arizportfolio.workers.dev';
}

// Legacy compatibility function for existing code
export async function queryMultipleRPC(query) {
    const endpoint = getEndpoint();

    try {
        // Get headers with authorization if needed
        const headers = {
            'Content-Type': 'application/json',
        };

        // Add authorization for production endpoint
        if (!window.TEST_RPC_ENDPOINT) {
            const accessToken = await getAccessToken();
            headers['Authorization'] = `Bearer ${accessToken}`;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(query)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'RPC Error');
        }

        return data;
    } catch (error) {
        console.error('queryMultipleRPC error:', error);
        throw error;
    }
}

// Legacy function for transaction status
export async function getTransactionStatusWithReceipts(txHash, accountId) {
    const query = {
        jsonrpc: "2.0",
        id: "1",
        method: "tx",
        params: [txHash, accountId]
    };
    return queryMultipleRPC(query);
}

// Export status and other utilities
export {
    status,
    getProxyClient
};