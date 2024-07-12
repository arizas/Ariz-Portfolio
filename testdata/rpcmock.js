const access_keys = [
    {
        access_key: {
            nonce: 109629226000005,
            permission: {
                FunctionCall: {
                    allowance: "241917078840755500000000",
                    method_names: [],
                    receiver_id: "arizportfolio.near",
                },
            },
        },
        public_key: "ed25519:GPphNAABcftyAH1tK9MCw69SprKHe5H1mTEncR6XBwL7",
    },
    {
        access_key: {
            nonce: 109629226000005,
            "permission": "FullAccess",
        },
        public_key: "ed25519:CziSGowWUKiP5N5pqGUgXCJXtqpySAk29YAU6zEs5RAi",
    }
];

export async function mockWalletRequests(ctx) {
    let transaction_completed = false;
    let last_receiver_id;
    let lastViewedAccessKey;
    await ctx.route(
        'https://rpc.mainnet.near.org',
        async (route) => {            
            const request = await route.request();
            const requestPostData = request.postDataJSON();

            if (
                requestPostData.params &&
                requestPostData.params.request_type === "view_access_key_list"
            ) {

                const json = {
                    jsonrpc: '2.0',
                    result: {
                        block_hash: 'HxCn3FxXJg2Bn3Abab7ssBSb3k32pR4o7C7c5xc2HxNq',
                        block_height: 123192799,
                        keys: access_keys
                    },
                    id: 123
                };

                await route.fulfill({ json });
            } else if (
                requestPostData.params &&
                requestPostData.params.request_type === "view_access_key"
            ) {
                const response = await route.fetch();
                const json = await response.json();

                lastViewedAccessKey = access_keys.find(
                    (k) => k.public_key === requestPostData.params.public_key
                );
                json.result = lastViewedAccessKey.access_key;
                delete json.error;

                await route.fulfill({ response, json });
            } else if (requestPostData.method == "broadcast_tx_commit") {
                transaction_completed = false;
                last_receiver_id =
                    lastViewedAccessKey.access_key.permission.FunctionCall.receiver_id;
                await page.waitForTimeout(1000);

                await route.fulfill({
                    json: {
                        jsonrpc: "2.0",
                        result: {
                            status: {
                                SuccessValue: "",
                            },
                            transaction: {
                                receiver_id: last_receiver_id,
                            },
                            transaction_outcome: {
                                proof: [],
                                block_hash: "9MzuZrRPW1BGpFnZJUJg6SzCrixPpJDfjsNeUobRXsLe",
                                id: "ASS7oYwGiem9HaNwJe6vS2kznx2CxueKDvU9BAYJRjNR",
                                outcome: {
                                    logs: [],
                                    receipt_ids: ["BLV2q6p8DX7pVgXRtGtBkyUNrnqkNyU7iSksXG7BjVZh"],
                                    gas_burnt: 223182562500,
                                    tokens_burnt: "22318256250000000000",
                                    executor_id: "sender.testnet",
                                    status: {
                                        SuccessReceiptId:
                                            "BLV2q6p8DX7pVgXRtGtBkyUNrnqkNyU7iSksXG7BjVZh",
                                    },
                                },
                            },
                            receipts_outcome: [],
                        },
                    },
                });
                transaction_completed = true;
            } else if(
                requestPostData.params?.method_name === 'get_account_id_for_token'
            ) {
                await route.fulfill({json: {
                    "jsonrpc": "2.0",
                    "result": {
                        "result": Array.from(new TextEncoder().encode('"test.near"')),
                        "logs": [],
                        "block_height": 123209158,
                        "block_hash": "BoNWWJzYgLk1u2y17FijLDohF5XDN3QaMRs4L2sASV8u"
                    },
                    "id": 123
                }});
            } else {
                await route.continue();
            }
        }
    );
}