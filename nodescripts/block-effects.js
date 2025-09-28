import { NearRpcClient, block, chunk } from '@near-js/jsonrpc-client';

const blockId = parseInt(process.argv[2]);
const client = new NearRpcClient("https://archival-rpc.mainnet.fastnear.com");
const blockResult = await block(client, { blockId: blockId });
for(const chunkHeader of blockResult.chunks) {
    const chunkResult = await chunk(client, { blockId: blockResult.header.hash, chunkId: chunkHeader.chunkHash, shardId: chunkHeader.shardId });
    console.log(JSON.stringify(chunkResult.transactions.filter(tx => tx.receiverId === 'intents.near'), null, 1));
}
