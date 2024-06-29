let archiveNodeUrl = 'https://1rpc.io/near';
//let archiveNodeUrl = 'https://archival-rpc.mainnet.near.org';
let helperNodeUrl = 'https://api.kitwallet.app'

export function getArchiveNodeUrl() {
    return archiveNodeUrl;
}

export function setArchiveNodeUrl(url) {
    archiveNodeUrl = url;
}

export function getHelperNodeUrl() {
    return helperNodeUrl;
}

export function setHelperNodeUrl(url) {
    helperNodeUrl = url;
}