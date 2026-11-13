// Encryption to a model enclave's attested key, and the check that an answer
// came from that enclave.
//
// NEAR AI's end-to-end encryption, protocol version 2: a field is encrypted to
// the enclave's Ed25519 key (converted to X25519) with a fresh ephemeral key,
// HKDF-SHA256 (no salt, info "ed25519_encryption") and XChaCha20-Poly1305, and
// sent as hex of [ephemeral public key 32][nonce 24][ciphertext and tag]. The
// enclave encrypts its answer the same way to this browser's key. With
// X-Encrypt-All-Fields the tool definitions, tool calls and tool results are
// encrypted too, not only the messages, so NEAR AI's gateway sees no content.
// Reference: nearai-cloud-verifier, py/encrypted_agent_loop_verifier.py.
//
// Each answer is also signed by the enclave: the text "<sha256 of the request
// body>:<sha256 of the response body>" under its attested key. Checking it shows
// the answer is the one the enclave produced for exactly what was sent.

import { ed25519, edwardsToMontgomeryPriv, edwardsToMontgomeryPub, x25519 } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, hexToBytes, NEAR_AI_API, sha256Hex } from './nearai-attestation.js';

const INFO = new TextEncoder().encode('ed25519_encryption');

/** This browser's key for one session: answers are encrypted to it. */
export function createClientKey() {
    const seed = ed25519.utils.randomPrivateKey();
    return { seed, publicKeyHex: bytesToHex(ed25519.getPublicKey(seed)) };
}

async function hkdfKey(shared) {
    const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
    // An absent salt is HashLen zero bytes (RFC 5869), which HMAC treats as the empty key.
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO }, material, 256));
}

/** Encrypt text to an Ed25519 public key (hex). */
export async function encryptTo(text, publicKeyHex) {
    const recipient = edwardsToMontgomeryPub(hexToBytes(publicKeyHex));
    const ephemeral = x25519.utils.randomPrivateKey();
    const key = await hkdfKey(x25519.getSharedSecret(ephemeral, recipient));
    const nonce = crypto.getRandomValues(new Uint8Array(24));
    const sealed = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(text));
    const out = new Uint8Array(32 + 24 + sealed.length);
    out.set(x25519.getPublicKey(ephemeral));
    out.set(nonce, 32);
    out.set(sealed, 56);
    return bytesToHex(out);
}

/** Decrypt a field encrypted to this browser's key. */
export async function decryptFrom(hex, seed) {
    const blob = hexToBytes(hex);
    if (blob.length < 32 + 24 + 16) throw new Error('the encrypted field is too short');
    const key = await hkdfKey(x25519.getSharedSecret(edwardsToMontgomeryPriv(seed), blob.subarray(0, 32)));
    return new TextDecoder().decode(xchacha20poly1305(key, blob.subarray(32, 56)).decrypt(blob.subarray(56)));
}

const isText = (value) => typeof value === 'string' && value.length > 0;

/**
 * The request body with every field that carries content encrypted to the
 * model's key: messages, tool definitions, tool calls and tool results.
 */
export async function encryptRequestBody(body, modelKey) {
    const seal = (text) => encryptTo(text, modelKey);
    const messages = await Promise.all((body.messages ?? []).map(async (message) => {
        const out = { ...message };
        if (isText(message.content)) out.content = await seal(message.content);
        if (isText(message.name)) out.name = await seal(message.name);
        if (isText(message.refusal)) out.refusal = await seal(message.refusal);
        if (Array.isArray(message.tool_calls)) {
            out.tool_calls = await Promise.all(message.tool_calls.map(async (call) => ({
                ...call,
                function: {
                    ...call.function,
                    name: await seal(call.function.name),
                    arguments: await seal(call.function.arguments ?? ''),
                },
            })));
        }
        return out;
    }));
    const tools = body.tools && await Promise.all(body.tools.map(async (tool) => (tool.type !== 'function' ? tool : {
        ...tool,
        function: {
            ...tool.function,
            name: await seal(tool.function.name),
            ...(tool.function.description !== undefined ? { description: await seal(tool.function.description) } : {}),
            ...(tool.function.parameters !== undefined ? { parameters: await seal(JSON.stringify(tool.function.parameters)) } : {}),
        },
    })));
    const toolChoice = body.tool_choice?.function?.name
        ? { ...body.tool_choice, function: { ...body.tool_choice.function, name: await seal(body.tool_choice.function.name) } }
        : body.tool_choice;
    return { ...body, messages, ...(tools ? { tools } : {}), ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}) };
}

/** The response body with what the enclave encrypted to this browser opened. */
export async function decryptResponseBody(body, seed) {
    const open = (hex) => decryptFrom(hex, seed);
    const choices = await Promise.all((body.choices ?? []).map(async (choice) => {
        const message = { ...(choice.message ?? {}) };
        for (const field of ['content', 'reasoning_content', 'reasoning', 'refusal']) {
            if (isText(message[field])) message[field] = await open(message[field]);
        }
        if (Array.isArray(message.tool_calls)) {
            message.tool_calls = await Promise.all(message.tool_calls.map(async (call) => ({
                ...call,
                function: {
                    ...call.function,
                    name: isText(call.function?.name) ? await open(call.function.name) : call.function?.name,
                    arguments: isText(call.function?.arguments) ? await open(call.function.arguments) : call.function?.arguments,
                },
            })));
        }
        return { ...choice, message };
    }));
    return { ...body, choices };
}

/** The headers that ask NEAR AI for encryption to the pinned enclave. */
export function encryptionHeaders(clientPublicKeyHex, modelKey) {
    return {
        'X-Signing-Algo': 'ed25519',
        'X-Client-Pub-Key': clientPublicKeyHex,
        'X-Encryption-Version': '2',
        'X-Encrypt-All-Fields': 'true',
        'X-Model-Pub-Key': modelKey,
        'x-no-aliasing': 'true',
    };
}

/**
 * Check that an answer is signed by the attested enclave for exactly this
 * request and response. Throws with what did not match.
 */
export async function verifyAnswerSignature({ chatId, model, requestBody, responseText, signingKey, apiKey, fetchFn = fetch }) {
    if (!chatId) throw new Error('the answer has no id to look its signature up by');
    const url = `${NEAR_AI_API}/v1/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(model)}&signing_algo=ed25519`;
    const response = await fetchFn(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(`NEAR AI has no signature for this answer (HTTP ${response.status})`);
    const { text, signature, signing_address: signer } = await response.json();
    const parts = String(text).split(':');
    if (parts.length !== 2 && parts.length !== 3) throw new Error('the signed text is not request:response hashes');
    const [requestHash, responseHash] = parts.slice(-2);
    if (requestHash !== await sha256Hex(requestBody)) throw new Error('the enclave signed a different request than the one sent');
    if (responseHash !== await sha256Hex(responseText)) throw new Error('the enclave signed a different answer than the one received');
    if (String(signer).toLowerCase() !== signingKey.toLowerCase()) throw new Error('the answer is signed by a key other than the verified enclave\'s');
    if (!ed25519.verify(hexToBytes(signature), new TextEncoder().encode(text), hexToBytes(signingKey))) {
        throw new Error('the enclave\'s signature on the answer does not verify');
    }
}
