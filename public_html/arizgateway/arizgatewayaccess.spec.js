import { ACCESS_TOKEN_SESSION_STORAGE_KEY, createAccessTokenPayload, isTokenValidForAccount } from './arizgatewayaccess.js';

export function mockWalletAuthenticationData() {
    localStorage.setItem("Ariz portfolio_wallet_auth_key", "{\"accountId\":\"test.near\",\"allKeys\":[\"ed25519:CziSGowWUKiP5N5pqGUgXCJXtqpySAk29YAU6zEs5RAi\"]}");
    localStorage.setItem("near-api-js:keystore:test.near:mainnet", "ed25519:eUVkG7dVfg5Z776MPy7d4L23cmEtAxrYoP1HgWSQrBy1GHdaZystRkYyz4ANN5uyKceuUrjyoLWaPgpzvo3BNDZ");
}

export async function mockArizGatewayAccess() {
    const {token } = await createAccessTokenPayload();
    localStorage.setItem(ACCESS_TOKEN_SESSION_STORAGE_KEY, token);
}
