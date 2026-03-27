/**
 * Signup page engine — OPNet wallet connection, signing, subscription
 * purchase, NFT decryption, and admin commands via OPWallet.
 *
 * Loaded as two script blocks by the template:
 *   1. Module script (this file, type="module") — CDN imports, ECIES, OPNet SDK
 *   2. Inline CONFIG object (in template) — injected by generator
 *   3. Application logic (appended below module) — uses CONFIG + window.OPNet/ECIES
 *
 * This file is a single JS file that self-initializes on DOMContentLoaded.
 * It expects a global CONFIG object to already exist when it runs.
 *
 * Required DOM element IDs (per PAGE_TEMPLATE_INTERFACE.md):
 *   btn-connect, btn-sign, btn-purchase, wallet-address, plan-select,
 *   days-input, total-cost, status-message, step-connect, step-sign,
 *   step-purchase, step-servers, server-list
 *
 * CSS classes toggled:
 *   hidden, active, completed, disabled, loading, error, success
 */

// ═══════════════════════════════════════════════════════════════════════
// Module imports (CDN) — ECIES encryption, SHAKE256, OPNet SDK
// ═══════════════════════════════════════════════════════════════════════

import { secp256k1 } from 'https://esm.run/@noble/curves@1.4.0/secp256k1';
import { hkdf } from 'https://esm.run/@noble/hashes@1.4.0/hkdf';
import { sha256 } from 'https://esm.run/@noble/hashes@1.4.0/sha256';
import { randomBytes } from 'https://esm.run/@noble/hashes@1.4.0/utils';
import { shake256 } from 'https://esm.run/@noble/hashes@1.4.0/sha3';
import {
    JSONRpcProvider, getContract, ABIDataTypes, BitcoinAbiTypes, OP_20_ABI, BitcoinUtils,
} from 'https://cdn.jsdelivr.net/npm/opnet@1.8.1-rc.15/browser/index.js';

// ═══════════════════════════════════════════════════════════════════════
// ECIES encryption (secp256k1 ECDH + HKDF + AES-GCM)
// ═══════════════════════════════════════════════════════════════════════

function _hexToBytes(hex) {
    hex = hex.startsWith('0x') ? hex.slice(2) : hex;
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

function _bytesToHex(bytes) {
    return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

window.ECIES = {
    hexToBytes: _hexToBytes,
    bytesToHex: _bytesToHex,

    async encrypt(publicKeyHex, plaintext) {
        var serverPubKeyBytes = _hexToBytes(publicKeyHex);
        var ephemeralPrivKey = randomBytes(32);
        var ephemeralPubKey = secp256k1.getPublicKey(ephemeralPrivKey, false);
        var sharedPoint = secp256k1.getSharedSecret(ephemeralPrivKey, serverPubKeyBytes, false);
        var sharedX = sharedPoint.slice(1, 33);
        var encryptionKey = hkdf(sha256, sharedX, new Uint8Array(0), new Uint8Array(0), 32);
        var iv = randomBytes(12);
        var cryptoKey = await crypto.subtle.importKey('raw', encryptionKey, { name: 'AES-GCM' }, false, ['encrypt']);
        var plaintextBytes = new TextEncoder().encode(plaintext);
        var ciphertextWithTag = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, plaintextBytes);
        var result = new Uint8Array(ephemeralPubKey.length + iv.length + ciphertextWithTag.byteLength);
        result.set(ephemeralPubKey, 0);
        result.set(iv, ephemeralPubKey.length);
        result.set(new Uint8Array(ciphertextWithTag), ephemeralPubKey.length + iv.length);
        return '0x' + _bytesToHex(result);
    }
};

// SHAKE256 key derivation
window.deriveKey = function(signatureBytes) {
    return shake256(signatureBytes, { dkLen: 32 });
};

// ═══════════════════════════════════════════════════════════════════════
// OPNet contract interaction layer
// ═══════════════════════════════════════════════════════════════════════

// Network configs (static — avoids pulling in @btc-vision/bitcoin in browser)
var NETWORKS = {
    bitcoin:  { messagePrefix: "\x18Bitcoin Signed Message:\n", bech32: "bc",   bech32Opnet: "op",  bip32: { public: 76067358, private: 76066276 }, pubKeyHash: 0,   scriptHash: 5,   wif: 128 },
    testnet:  { messagePrefix: "\x18Bitcoin Signed Message:\n", bech32: "tb",   bech32Opnet: "opt", bip32: { public: 70617039, private: 70615956 }, pubKeyHash: 111, scriptHash: 196, wif: 239 },
    regtest:  { messagePrefix: "\x18Bitcoin Signed Message:\n", bech32: "bcrt", bech32Opnet: "opr", bip32: { public: 70617039, private: 70615956 }, pubKeyHash: 111, scriptHash: 196, wif: 239 },
};

function inferNetwork(rpcUrl) {
    if (rpcUrl.includes('mainnet')) return NETWORKS.bitcoin;
    if (rpcUrl.includes('testnet')) return NETWORKS.testnet;
    return NETWORKS.regtest;
}

// Bech32m decoder — extracts the 32-byte witness program from a bech32m P2TR address
var BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
var BECH32_REV = {};
for (var _ci = 0; _ci < 32; _ci++) BECH32_REV[BECH32_CHARSET.charAt(_ci)] = _ci;

function _convertBits(data, fromBits, toBits, pad) {
    var acc = 0, bits = 0, ret = [], maxv = (1 << toBits) - 1;
    for (var i = 0; i < data.length; i++) {
        acc = (acc << fromBits) | data[i];
        bits += fromBits;
        while (bits >= toBits) { bits -= toBits; ret.push((acc >>> bits) & maxv); }
    }
    if (pad && bits > 0) ret.push((acc << (toBits - bits)) & maxv);
    return ret;
}

function bech32mToHex(addr) {
    var pos = addr.lastIndexOf('1');
    if (pos < 1) return null;
    var dataPart = addr.slice(pos + 1).toLowerCase();
    var values5 = [];
    for (var i = 0; i < dataPart.length - 6; i++) {
        var v = BECH32_REV[dataPart.charAt(i)];
        if (v === undefined) return null;
        values5.push(v);
    }
    var version = values5[0];
    if (version !== 1) return null;
    var programBytes = _convertBits(values5.slice(1), 5, 8, false);
    if (programBytes.length !== 32) return null;
    return '0x' + programBytes.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function normalizeWalletAddress(addr, network) {
    if (!addr || !network.bech32Opnet) return addr;
    var lower = addr.toLowerCase();
    if (lower.startsWith(network.bech32Opnet + '1')) {
        return bech32mToHex(addr) || addr;
    }
    return addr;
}

// Contract ABIs
var ABI = ABIDataTypes;

var SUBSCRIPTIONS_ABI = [
    { name: 'getTotalPlanCount', type: BitcoinAbiTypes.Function, constant: true,
      inputs: [], outputs: [{ name: 'count', type: ABI.UINT256 }] },
    { name: 'getPlan', type: BitcoinAbiTypes.Function, constant: true,
      inputs: [{ name: 'planId', type: ABI.UINT256 }],
      outputs: [{ name: 'name', type: ABI.STRING }, { name: 'pricePerDay', type: ABI.UINT256 }, { name: 'active', type: ABI.BOOL }] },
    { name: 'buySubscription', type: BitcoinAbiTypes.Function, constant: false,
      inputs: [{ name: 'planId', type: ABI.UINT256 }, { name: 'days', type: ABI.UINT256 }, { name: 'userEncrypted', type: ABI.STRING }],
      outputs: [{ name: 'subscriptionId', type: ABI.UINT256 }] },
];

var NFT_ABI = [
    { name: 'balanceOf', type: BitcoinAbiTypes.Function, constant: true,
      inputs: [{ name: 'owner', type: ABI.ADDRESS }],
      outputs: [{ name: 'balance', type: ABI.UINT256 }] },
    { name: 'ownerOf', type: BitcoinAbiTypes.Function, constant: true,
      inputs: [{ name: 'tokenId', type: ABI.UINT256 }],
      outputs: [{ name: 'owner', type: ABI.ADDRESS }] },
    { name: 'tokenOfOwnerByIndex', type: BitcoinAbiTypes.Function, constant: true,
      inputs: [{ name: 'owner', type: ABI.ADDRESS }, { name: 'index', type: ABI.UINT256 }],
      outputs: [{ name: 'tokenId', type: ABI.UINT256 }] },
    { name: 'getUserEncrypted', type: BitcoinAbiTypes.Function, constant: true,
      inputs: [{ name: 'tokenId', type: ABI.UINT256 }],
      outputs: [{ name: 'userEncrypted', type: ABI.STRING }] },
];

// Provider cache
var _providerCache = {};
function getProvider(rpcUrl) {
    if (!_providerCache[rpcUrl]) {
        _providerCache[rpcUrl] = new JSONRpcProvider({ url: rpcUrl, network: inferNetwork(rpcUrl) });
    }
    return _providerCache[rpcUrl];
}

window.OPNet = {
    getSubscriptionsContract: function(rpcUrl, contractAddress, sender) {
        var provider = getProvider(rpcUrl);
        return getContract(contractAddress, SUBSCRIPTIONS_ABI, provider, provider.network, sender);
    },
    getOP20Contract: function(rpcUrl, tokenAddress, sender) {
        var provider = getProvider(rpcUrl);
        return getContract(tokenAddress, OP_20_ABI, provider, provider.network, sender);
    },
    getNftContract: function(rpcUrl, contractAddress, sender) {
        var provider = getProvider(rpcUrl);
        return getContract(contractAddress, NFT_ABI, provider, provider.network, sender);
    },
    resolveAddress: async function(rpcUrl, address, isContract) {
        var provider = getProvider(rpcUrl);
        var normalized = normalizeWalletAddress(address, provider.network);
        return await provider.getPublicKeyInfo(normalized, !!isContract);
    },
    trackTransaction: async function(rpcUrl, txId, onStatus, timeoutMs) {
        var provider = getProvider(rpcUrl);
        var elapsed = 0;
        var interval = 4000;
        var maxMs = timeoutMs || 1800000;
        var inMempool = false;

        while (elapsed < maxMs) {
            try {
                var tx = await provider.getTransaction(txId);
                if (tx) {
                    onStatus('mined', tx);
                    return 'mined';
                }
            } catch (_) { /* not mined yet */ }

            try {
                if (!inMempool) {
                    var pending = await provider.getPendingTransaction(txId);
                    if (pending) {
                        inMempool = true;
                        onStatus('mempool', pending);
                    }
                }
            } catch (_) { /* not in mempool yet */ }

            await new Promise(function(r) { setTimeout(r, interval); });
            elapsed += interval;
        }
        onStatus('error', 'Tracking timed out after ' + Math.round(maxMs / 1000) + 's');
        return 'timeout';
    },
    getBlockInfo: async function(rpcUrl) {
        var provider = getProvider(rpcUrl);
        try {
            var height = await provider.getBlockNumber();
            var block = await provider.getBlock(height, false);
            var timestamp = block ? Number(block.timeStamp || block.timestamp || 0) : 0;
            var ageSecs = timestamp ? Math.floor(Date.now() / 1000) - timestamp : 0;
            return { height: Number(height), ageSecs: ageSecs > 0 ? ageSecs : 0 };
        } catch (_) {
            return null;
        }
    },
    inferNetwork: inferNetwork,
    expandToDecimals: BitcoinUtils.expandToDecimals.bind(BitcoinUtils),
};

console.log('ECIES encryption + SHAKE256 + OPNet contract ready');

// ═══════════════════════════════════════════════════════════════════════
// Application logic — reads global CONFIG, manages UI state
// ═══════════════════════════════════════════════════════════════════════

function isValidAddress(addr) {
    return typeof addr === 'string' && /^0x[0-9a-fA-F]{64}$/.test(addr);
}

function uint8ToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToUint8(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function hexToBytes(hex) {
    hex = hex.startsWith('0x') ? hex.slice(2) : hex;
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

async function decryptAesGcm(keyBytes, ciphertextHex) {
    ciphertextHex = ciphertextHex.replace(/^0x/, '');
    var data = new Uint8Array(ciphertextHex.length / 2);
    for (var i = 0; i < ciphertextHex.length; i += 2) data[i / 2] = parseInt(ciphertextHex.substr(i, 2), 16);

    var nonce = data.slice(0, 12);
    var ciphertext = data.slice(12);

    var key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    var decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
}

function getWallet() {
    if (window.opnet && typeof window.opnet.requestAccounts === 'function') {
        return window.opnet;
    }
    return null;
}

function hasWeb3Provider() {
    return wallet && wallet.web3 && typeof wallet.web3.signMLDSAMessage === 'function';
}

// ── Status & step helpers (CSS class contract) ────────────────────────

function showStatus(element, message, type) {
    type = type || 'info';
    element.innerHTML = '<div class="status ' + type + '">' + message + '</div>';
}

function setMainStatus(msg, type) {
    var el = document.getElementById('status-message');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden', 'error', 'success');
    if (type) el.classList.add(type);
    if (!msg) el.classList.add('hidden');
}

function updateStep(stepNum, status) {
    var el = document.getElementById('step' + stepNum + '-num');
    if (!el) return;
    el.classList.remove('done', 'error');
    if (status === 'done') {
        el.classList.add('done');
        el.textContent = '\u2713';
    } else if (status === 'error') {
        el.classList.add('error');
        el.textContent = '!';
    } else {
        el.textContent = stepNum;
    }
}

function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.classList.add('loading', 'disabled');
        btn.disabled = true;
    } else {
        btn.classList.remove('loading', 'disabled');
        btn.disabled = false;
    }
}

// Tab switching for View My Servers
window.switchTab = function(tab) {
    document.getElementById('tab-wallet').classList.toggle('active', tab === 'wallet');
    document.getElementById('tab-offline').classList.toggle('active', tab === 'offline');
    document.getElementById('mode-wallet').classList.toggle('hidden', tab !== 'wallet');
    document.getElementById('mode-offline').classList.toggle('hidden', tab !== 'offline');
};

// ── State ─────────────────────────────────────────────────────────────

var wallet = null;
var userAddress = null;
var userSignature = null;
var encryptedSignature = null;
var plans = [];
var userNfts = [];
var selectedNft = null;

// ── DOM Elements ──────────────────────────────────────────────────────

var btnConnect = document.getElementById('btn-connect');
var btnSign = document.getElementById('btn-sign');
var btnPurchase = document.getElementById('btn-purchase');
var walletNotConnected = document.getElementById('wallet-not-connected');
var walletConnected = document.getElementById('wallet-connected');
var walletAddressEl = document.getElementById('wallet-address');
var daysInput = document.getElementById('days-input');
var planSelect = document.getElementById('plan-select');
var totalCostEl = document.getElementById('total-cost');
var signatureStatus = document.getElementById('signature-status');
var purchaseStatus = document.getElementById('purchase-status');
var resultCard = document.getElementById('result-card');

// ── Plan loading ──────────────────────────────────────────────────────

async function loadPlans() {
    if (!CONFIG.subscriptionContract) {
        console.warn('Subscription contract not configured');
        return;
    }

    try {
        var contract = window.OPNet.getSubscriptionsContract(CONFIG.rpcUrl, CONFIG.subscriptionContract);
        var countResult = await contract.getTotalPlanCount();
        if ('error' in countResult) {
            throw new Error(countResult.error);
        }
        var totalPlans = Number(countResult.properties.count);
        console.log('Total plans:', totalPlans);

        plans = [];
        planSelect.innerHTML = '';

        for (var i = 1; i <= totalPlans; i++) {
            try {
                var planResult = await contract.getPlan(BigInt(i));
                if ('error' in planResult) {
                    console.warn('Error loading plan ' + i + ':', planResult.error);
                    continue;
                }
                var p = planResult.properties;
                if (p.active) {
                    var pricePerDay = Number(p.pricePerDay);
                    plans.push({ id: i, name: p.name, pricePerDay: pricePerDay });
                    var option = document.createElement('option');
                    option.value = i;
                    option.textContent = p.name + ' - ' + pricePerDay + ' tokens/day';
                    planSelect.appendChild(option);
                }
            } catch (e) {
                console.warn('Error loading plan ' + i + ':', e);
            }
        }

        if (plans.length === 0) {
            planSelect.innerHTML = '<option value="">No plans available</option>';
        }
    } catch (err) {
        console.error('Error loading plans:', err);
        planSelect.innerHTML = '<option value="">Error loading plans</option>';
    }
}

// ── NFT loading ───────────────────────────────────────────────────────

async function loadUserNfts() {
    if (!CONFIG.nftContract || !userAddress) {
        console.warn('NFT contract not configured or wallet not connected');
        return;
    }

    document.getElementById('servers-not-connected').classList.add('hidden');
    document.getElementById('servers-loading').classList.remove('hidden');
    document.getElementById('server-list').classList.add('hidden');
    document.getElementById('servers-empty').classList.add('hidden');
    document.getElementById('servers-decrypt').classList.add('hidden');
    document.getElementById('connection-result').classList.add('hidden');

    try {
        var opnetAddr = await window.OPNet.resolveAddress(CONFIG.rpcUrl, userAddress);
        if (!opnetAddr) {
            throw new Error('Could not resolve wallet address');
        }

        var nftContract = window.OPNet.getNftContract(CONFIG.rpcUrl, CONFIG.nftContract, opnetAddr);

        var balanceResult = await nftContract.balanceOf(opnetAddr);
        var balance = balanceResult.properties?.balance || 0n;
        console.log('NFT balance:', balance.toString());

        if (balance === 0n || balance === 0) {
            document.getElementById('servers-loading').classList.add('hidden');
            document.getElementById('servers-empty').classList.remove('hidden');
            return;
        }

        userNfts = [];
        for (var i = 0n; i < balance; i++) {
            var tokenResult = await nftContract.tokenOfOwnerByIndex(opnetAddr, i);
            var tokenId = tokenResult.properties?.tokenId;
            if (!tokenId && tokenId !== 0n) continue;

            var encResult = await nftContract.getUserEncrypted(tokenId);
            var userEncrypted = encResult.properties?.userEncrypted || '';

            userNfts.push({
                tokenId: tokenId.toString(),
                name: 'Server #' + tokenId.toString(),
                userEncrypted: userEncrypted,
            });
        }

        document.getElementById('servers-loading').classList.add('hidden');

        if (userNfts.length > 0) {
            document.getElementById('server-list').classList.remove('hidden');
            renderNftList();
        } else {
            document.getElementById('servers-empty').classList.remove('hidden');
        }

    } catch (err) {
        console.error('Error loading NFTs:', err);
        document.getElementById('servers-loading').classList.add('hidden');
        document.getElementById('servers-empty').classList.remove('hidden');
        document.getElementById('servers-empty').innerHTML =
            '<p>Error loading NFTs: ' + (err.message || err) + '</p>';
    }
}

function renderNftList() {
    var container = document.getElementById('server-list');
    container.innerHTML = '';

    userNfts.forEach(function(nft, index) {
        var card = document.createElement('div');
        card.className = 'server-card' + (index === 0 ? ' selected' : '');
        card.innerHTML =
            '<div class="server-card-header">' +
                '<span class="server-card-title">' + (nft.name || 'Server') + '</span>' +
                '<span class="server-card-id">Token #' + nft.tokenId + '</span>' +
            '</div>';
        card.onclick = function() { selectNft(index); };
        container.appendChild(card);
    });

    if (userNfts.length > 0) {
        selectNft(0);
    }
}

function selectNft(index) {
    selectedNft = userNfts[index];
    document.querySelectorAll('.server-card').forEach(function(card, i) {
        card.classList.toggle('selected', i === index);
    });
    document.getElementById('servers-decrypt').classList.remove('hidden');
    document.getElementById('connection-result').classList.add('hidden');
    document.getElementById('decrypt-wallet-status').innerHTML = '';
}

// ── Decrypt (wallet mode) ─────────────────────────────────────────────

document.getElementById('btn-decrypt-wallet').addEventListener('click', async function() {
    if (!selectedNft || !wallet) return;

    var btn = document.getElementById('btn-decrypt-wallet');
    var statusEl = document.getElementById('decrypt-wallet-status');

    try {
        setButtonLoading(btn, true);

        var userEncrypted = selectedNft.userEncrypted;
        if (!userEncrypted) {
            throw new Error('No encrypted data found in NFT');
        }

        var sigResult = await wallet.signMessage(CONFIG.publicSecret, 'schnorr');

        showStatus(statusEl, 'Decrypting...', 'info');

        var sigBytes = typeof sigResult === 'string' ? hexToBytes(sigResult) : new Uint8Array(sigResult);
        var keyBytes = window.deriveKey(sigBytes);

        var decrypted = await decryptAesGcm(keyBytes, userEncrypted);

        document.getElementById('connection-info').textContent = decrypted;
        document.getElementById('connection-result').classList.remove('hidden');
        statusEl.innerHTML = '';

    } catch (err) {
        console.error('Decrypt error:', err);
        showStatus(statusEl, err.message || 'Decryption failed', 'error');
    } finally {
        setButtonLoading(btn, false);
        btn.textContent = 'Sign to Decrypt Connection Info';
    }
});

// ── NFT lookup (offline mode) ─────────────────────────────────────────

document.getElementById('btn-lookup-nft').addEventListener('click', async function() {
    var statusEl = document.getElementById('offline-lookup-status');
    var btn = document.getElementById('btn-lookup-nft');

    if (!CONFIG.nftContract) {
        showStatus(statusEl, 'NFT contract not configured', 'error');
        return;
    }

    var tokenId = document.getElementById('offline-token-id').value;
    if (!tokenId) {
        showStatus(statusEl, 'Please enter a token ID', 'error');
        return;
    }

    try {
        setButtonLoading(btn, true);
        showStatus(statusEl, 'Querying NFT contract...', 'info');

        var nftContract = window.OPNet.getNftContract(CONFIG.rpcUrl, CONFIG.nftContract);

        var encResult = await nftContract.getUserEncrypted(BigInt(tokenId));
        var userEncrypted = encResult.properties?.userEncrypted || '';

        if (!userEncrypted) {
            showStatus(statusEl, 'No encrypted data found for token #' + tokenId, 'error');
            return;
        }

        window.offlineNftData = { tokenId: tokenId, userEncrypted: userEncrypted };

        showStatus(statusEl,
            'Found encrypted data for token #' + tokenId + ' (' + userEncrypted.length + ' chars).', 'success');

        document.getElementById('offline-public-secret').textContent = CONFIG.publicSecret;
        document.getElementById('offline-encrypted-data').textContent = userEncrypted;
        document.getElementById('offline-cli-instructions').innerHTML =
            'Sign the message above using Schnorr (not ML-DSA) and paste the hex signature below.<br><br>' +
            '<code>npm install @noble/curves</code><br><br>' +
            '<code>node -e "const {schnorr}=require(\'@noble/curves/secp256k1\');\n' +
            'const msg=Buffer.from(\'' + CONFIG.publicSecret + '\');\n' +
            'const sig=schnorr.sign(msg, \'YOUR_PRIVATE_KEY_HEX\');\n' +
            'console.log(Buffer.from(sig).toString(\'hex\'));"</code>';
        document.getElementById('offline-nft-info').classList.remove('hidden');

    } catch (err) {
        console.error('NFT lookup error:', err);
        showStatus(statusEl, 'Lookup failed: ' + (err.message || err), 'error');
    } finally {
        setButtonLoading(btn, false);
        btn.textContent = 'Lookup NFT';
    }
});

// ── Decrypt (offline mode) ────────────────────────────────────────────

document.getElementById('btn-decrypt-offline').addEventListener('click', async function() {
    var statusEl = document.getElementById('decrypt-offline-status');
    var signatureInput = document.getElementById('offline-signature').value.trim();

    if (!signatureInput) {
        showStatus(statusEl, 'Please paste your Schnorr signature (hex)', 'error');
        return;
    }

    if (!window.offlineNftData) {
        showStatus(statusEl, 'Please lookup an NFT first', 'error');
        return;
    }

    try {
        showStatus(statusEl, 'Decrypting...', 'info');

        var sigBytes = hexToBytes(signatureInput);
        var keyBytes = window.deriveKey(sigBytes);
        var decrypted = await decryptAesGcm(keyBytes, window.offlineNftData.userEncrypted);

        document.getElementById('offline-connection-info').textContent = decrypted;
        document.getElementById('offline-connection-result').classList.remove('hidden');
        statusEl.innerHTML = '';

    } catch (err) {
        console.error('Decrypt error:', err);
        showStatus(statusEl, 'Decryption failed. Make sure you signed the correct message with the correct key.', 'error');
    }
});

// ── Step 1: Connect OPWallet ──────────────────────────────────────────

btnConnect.addEventListener('click', async function() {
    try {
        setButtonLoading(btnConnect, true);

        wallet = getWallet();
        if (!wallet) {
            throw new Error('No OPWallet found. Install the OPWallet browser extension.');
        }

        var accounts = await wallet.requestAccounts();
        if (!accounts || !accounts.length) {
            throw new Error('No accounts returned from OPWallet');
        }

        userAddress = accounts[0];

        walletNotConnected.classList.add('hidden');
        walletConnected.classList.remove('hidden');
        walletAddressEl.textContent = userAddress;
        updateStep(1, 'done');
        btnSign.disabled = false;

        loadUserNfts();

        document.getElementById('admin-not-connected').classList.add('hidden');
        document.getElementById('admin-connected').classList.remove('hidden');

    } catch (err) {
        showStatus(signatureStatus, err.message, 'error');
        updateStep(1, 'error');
        setButtonLoading(btnConnect, false);
        btnConnect.textContent = 'Connect OPWallet';
    }
});

// ── Step 2: Sign Message ──────────────────────────────────────────────

btnSign.addEventListener('click', async function() {
    try {
        setButtonLoading(btnSign, true);

        if (!wallet) {
            throw new Error('Wallet not connected');
        }

        var sigResult = await wallet.signMessage(CONFIG.publicSecret, 'schnorr');
        userSignature = typeof sigResult === 'string' ? hexToBytes(sigResult) : new Uint8Array(sigResult);

        showStatus(signatureStatus, 'Encrypting credentials...', 'info');
        encryptedSignature = await window.ECIES.encrypt(CONFIG.serverPublicKey, sigResult);

        showStatus(signatureStatus, 'Authentication complete!', 'success');
        updateStep(2, 'done');

        planSelect.disabled = false;
        daysInput.disabled = false;
        btnPurchase.disabled = false;
        updateCost();

    } catch (err) {
        console.error('Sign error:', err);
        showStatus(signatureStatus, err.message, 'error');
        updateStep(2, 'error');
        setButtonLoading(btnSign, false);
        btnSign.textContent = 'Sign Authentication';
    }
});

// ── Cost calculation ──────────────────────────────────────────────────

async function updateCost() {
    var planId = parseInt(planSelect.value);
    var days = parseInt(daysInput.value) || 30;
    var plan = plans.find(function(p) { return p.id === planId; });
    if (plan) {
        var total = days * plan.pricePerDay;
        totalCostEl.textContent = total + ' tokens';
    } else {
        totalCostEl.textContent = '-';
    }
}

daysInput.addEventListener('input', updateCost);
planSelect.addEventListener('change', updateCost);

// ── Confirmation tracker ──────────────────────────────────────────────

var confirmTracker = {
    txId: null, startTime: null, confirmed: false,
    pollId: null, timerId: null,
    blockAge: undefined, blockAgeAt: null
};

function startConfirmationTracker(txId, subId, planName, days) {
    // Stop any previous tracker
    clearInterval(confirmTracker.pollId);
    clearInterval(confirmTracker.timerId);

    confirmTracker = {
        txId: txId, startTime: Date.now(), confirmed: false,
        pollId: null, timerId: null,
        blockAge: undefined, blockAgeAt: null
    };

    resultCard.classList.remove('hidden');
    resultCard.innerHTML =
        '<h2>Subscription #' + subId + '</h2>' +
        '<p>Plan: ' + planName + ' &middot; ' + days + ' days</p>' +
        '<div id="tx-tracker" style="margin-top: 1rem;">' +
            '<div style="font-family: monospace; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem; word-break: break-all;">' +
                'txid: ' + txId +
            '</div>' +
            '<div id="tx-status" style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">' +
                '<span class="spinner"></span>' +
                '<span style="font-weight: 500;">Broadcast</span>' +
            '</div>' +
            '<div id="tx-mempool" style="font-size: 0.875rem; margin-bottom: 0.25rem;">Checking mempool...</div>' +
            '<div id="tx-block" style="font-size: 0.875rem; margin-bottom: 0.25rem;">Fetching block info...</div>' +
            '<div id="tx-timer" style="font-size: 0.875rem; margin-bottom: 0.75rem;"></div>' +
            '<div id="tx-hint" style="font-size: 0.8rem; color: var(--text-muted);">' +
                'Waiting for next block (Bitcoin blocks average ~10 minutes)' +
            '</div>' +
            '<label style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.75rem; font-size: 0.8rem; cursor: pointer;">' +
                '<input type="checkbox" id="tx-sound-chk" style="width: auto; margin: 0;">' +
                'Play sound when confirmed' +
            '</label>' +
        '</div>';

    // Initial poll + start intervals
    pollTxConfirmation();
    confirmTracker.pollId = setInterval(function() {
        if (!confirmTracker.confirmed) pollTxConfirmation();
    }, 15000);
    confirmTracker.timerId = setInterval(updateTxTimer, 1000);
}

function pollTxConfirmation() {
    // Fetch block info
    window.OPNet.getBlockInfo(CONFIG.rpcUrl).then(function(info) {
        var el = document.getElementById('tx-block');
        if (!el || !info) return;
        var text = 'Block #' + info.height.toLocaleString();
        if (info.ageSecs !== undefined) {
            var bm = Math.floor(info.ageSecs / 60);
            var bs = info.ageSecs % 60;
            text += ' (mined ' + bm + 'm ' + bs + 's ago)';
            confirmTracker.blockAge = info.ageSecs;
            confirmTracker.blockAgeAt = Date.now();
        }
        el.textContent = text;
    }).catch(function() {});

    // Check mempool / mined status using the provider directly
    var rpcProvider = getProvider(CONFIG.rpcUrl);

    rpcProvider.getTransaction(confirmTracker.txId).then(function(tx) {
        if (tx) markTxConfirmed('Confirmed in block');
    }).catch(function() {});

    if (!confirmTracker.confirmed) {
        rpcProvider.getPendingTransaction(confirmTracker.txId).then(function(pending) {
            if (pending) {
                var el = document.getElementById('tx-mempool');
                if (el) el.innerHTML = '<span style="color: var(--success);">In mempool</span> — waiting to be mined';
            }
        }).catch(function() {});
    }
}

function markTxConfirmed(reason) {
    if (confirmTracker.confirmed) return;
    confirmTracker.confirmed = true;

    clearInterval(confirmTracker.pollId);
    clearInterval(confirmTracker.timerId);

    var statusEl = document.getElementById('tx-status');
    var mempoolEl = document.getElementById('tx-mempool');
    var hintEl = document.getElementById('tx-hint');
    var spinner = statusEl ? statusEl.querySelector('.spinner') : null;

    if (spinner) spinner.style.display = 'none';
    if (statusEl) statusEl.querySelector('span:last-child').textContent = 'Confirmed';
    if (mempoolEl) mempoolEl.innerHTML = '<span style="color: var(--success);">' + reason + '</span>';
    if (hintEl) hintEl.innerHTML = '<span style="color: var(--success);">Subscription confirmed! Your server will be provisioned shortly.</span>';

    showStatus(purchaseStatus, 'Subscription confirmed! Your server will be provisioned shortly.', 'success');
    updateStep(3, 'done');

    // Play confirmation sound
    if (document.getElementById('tx-sound-chk') && document.getElementById('tx-sound-chk').checked) {
        playConfirmSound();
    }
}

function updateTxTimer() {
    if (confirmTracker.confirmed) return;

    var timerEl = document.getElementById('tx-timer');
    if (!timerEl) return;

    var elapsed = Math.floor((Date.now() - confirmTracker.startTime) / 1000);
    var mins = Math.floor(elapsed / 60);
    var secs = elapsed % 60;
    var parts = ['Elapsed: ' + mins + ':' + (secs < 10 ? '0' : '') + secs];

    if (confirmTracker.blockAge !== undefined && confirmTracker.blockAgeAt) {
        var extraSecs = Math.floor((Date.now() - confirmTracker.blockAgeAt) / 1000);
        var totalAge = confirmTracker.blockAge + extraSecs;
        var bm = Math.floor(totalAge / 60);
        var bs = totalAge % 60;
        parts.push('Last block: ' + bm + 'm ' + bs + 's ago');
    }

    timerEl.textContent = parts.join('  |  ');
}

function playConfirmSound() {
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Two-tone chime: C5 then E5
        [523.25, 659.25].forEach(function(freq, i) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.4);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.15);
            osc.stop(ctx.currentTime + i * 0.15 + 0.4);
        });
    } catch (_) {}
}

// ── Step 3: Purchase ──────────────────────────────────────────────────

btnPurchase.addEventListener('click', async function() {
    try {
        setButtonLoading(btnPurchase, true);

        var planId = parseInt(planSelect.value);
        var days = parseInt(daysInput.value);

        if (!CONFIG.subscriptionContract || !CONFIG.paymentToken) {
            throw new Error('Contract addresses not configured');
        }

        if (!planId || planId < 1) {
            throw new Error('Please select a plan');
        }

        if (!days || days < 1) {
            throw new Error('Please enter number of days');
        }

        if (!encryptedSignature) {
            throw new Error('Please complete authentication first (Step 2)');
        }

        if (!userAddress) {
            throw new Error('Wallet not connected');
        }

        var plan = plans.find(function(p) { return p.id === planId; });
        if (!plan) {
            throw new Error('Selected plan not found');
        }
        var totalCostHuman = BigInt(days) * BigInt(plan.pricePerDay);
        showStatus(purchaseStatus, 'Total cost: ' + totalCostHuman.toString() + ' tokens. Resolving address...', 'info');

        var opnetAddress = await window.OPNet.resolveAddress(CONFIG.rpcUrl, userAddress);
        if (!opnetAddress) {
            throw new Error('Could not resolve wallet address. Make sure your address is indexed on OPNet.');
        }
        console.log('Resolved OPNet address:', opnetAddress.toHex());

        var tokenContract = window.OPNet.getOP20Contract(CONFIG.rpcUrl, CONFIG.paymentToken, opnetAddress);

        var decimalsResult = await tokenContract.decimals();
        if ('error' in decimalsResult) {
            throw new Error('Failed to get token decimals: ' + decimalsResult.error);
        }
        var tokenDecimals = decimalsResult.properties.decimals;
        var totalCost = window.OPNet.expandToDecimals(totalCostHuman.toString(), tokenDecimals);
        console.log('Token decimals:', tokenDecimals, 'Total cost (expanded):', totalCost.toString());

        var balanceResult = await tokenContract.balanceOf(opnetAddress);
        if ('error' in balanceResult) {
            throw new Error('Failed to check balance: ' + balanceResult.error);
        }
        var balance = balanceResult.properties.balance;
        console.log('Token balance:', balance.toString(), 'Required:', totalCost.toString());

        if (balance < totalCost) {
            throw new Error('Insufficient token balance. Have: ' + balance.toString() + ', need: ' + totalCost.toString());
        }

        var subsAddress = await window.OPNet.resolveAddress(CONFIG.rpcUrl, CONFIG.subscriptionContract, true);
        if (!subsAddress) {
            throw new Error('Could not resolve subscription contract address');
        }

        // increaseAllowance (NOT approve — OPNet convention)
        showStatus(purchaseStatus, 'Requesting allowance approval...', 'info');
        var allowanceSim = await tokenContract.increaseAllowance(subsAddress, totalCost);
        if ('error' in allowanceSim) {
            throw new Error('Allowance simulation failed: ' + allowanceSim.error);
        }
        if (allowanceSim.revert) {
            throw new Error('Allowance simulation reverted: ' + allowanceSim.revert);
        }

        console.log('Allowance simulation OK, sending transaction...');
        var network = window.OPNet.inferNetwork(CONFIG.rpcUrl);

        // Approve gets +200 priority fee to guarantee ordering before purchase
        var approveParams = {
            signer: null,
            mldsaSigner: null,
            refundTo: userAddress,
            priorityFee: 200n,
            feeRate: 1,
            maximumAllowedSatToSpend: 10000n,
            network: network,
        };
        var allowanceTx = await allowanceSim.sendTransaction(approveParams);
        console.log('Allowance tx:', allowanceTx.transactionId);
        showStatus(purchaseStatus, 'Allowance sent (' + allowanceTx.transactionId.slice(0, 12) + '...). Simulating purchase...', 'info');

        // buySubscription with accessList chaining
        var subsContract = window.OPNet.getSubscriptionsContract(CONFIG.rpcUrl, CONFIG.subscriptionContract, opnetAddress);
        subsContract.setAccessList(allowanceSim.accessList);

        var buySim = await subsContract.buySubscription(BigInt(planId), BigInt(days), encryptedSignature);
        if ('error' in buySim) {
            throw new Error('Purchase simulation failed: ' + buySim.error);
        }
        if (buySim.revert) {
            throw new Error('Purchase simulation reverted: ' + buySim.revert);
        }
        console.log('Purchase simulation OK (sub ID:', buySim.properties.subscriptionId.toString() + ')');

        showStatus(purchaseStatus, 'Sending purchase transaction...', 'info');
        var purchaseParams = {
            signer: null,
            mldsaSigner: null,
            refundTo: userAddress,
            priorityFee: 0n,
            feeRate: 0,
            maximumAllowedSatToSpend: 20000n,
            network: network,
        };
        var buyTx = await buySim.sendTransaction(purchaseParams);
        console.log('Purchase tx:', buyTx.transactionId);

        var subId = buySim.properties.subscriptionId;
        var txId = buyTx.transactionId;
        showStatus(purchaseStatus, '<span class="spinner"></span>Transaction sent. Waiting for confirmation...', 'info');

        // Launch the live confirmation tracker
        startConfirmationTracker(txId, subId.toString(), plan.name, days);

    } catch (err) {
        console.error(err);
        showStatus(purchaseStatus, err.message || 'Transaction failed', 'error');
        updateStep(3, 'error');
        setButtonLoading(btnPurchase, false);
        btnPurchase.textContent = 'Purchase Subscription';
    }
});

// ── Admin Commands ────────────────────────────────────────────────────

var _adminNonce = (function() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var nonce = '';
    var rand = crypto.getRandomValues(new Uint8Array(3));
    for (var i = 0; i < 3; i++) nonce += chars[rand[i] % chars.length];
    return nonce;
})();

document.getElementById('btn-send-command').addEventListener('click', async function() {
    var btn = document.getElementById('btn-send-command');
    var statusEl = document.getElementById('command-status');

    var commandInput = document.getElementById('command-input').value.trim();

    if (!commandInput) {
        showStatus(statusEl, 'Please enter a command', 'error');
        return;
    }

    if (!wallet) {
        showStatus(statusEl, 'Please connect your wallet first', 'error');
        return;
    }

    try {
        setButtonLoading(btn, true);

        var message = _adminNonce + ' ' + commandInput;

        showStatus(statusEl, 'Sign the message in OPWallet to authenticate...', 'info');
        var sigResult = await wallet.signMessage(CONFIG.publicSecret, 'schnorr');

        var sigBytes = typeof sigResult === 'string' ? hexToBytes(sigResult) : new Uint8Array(sigResult);
        var sharedKey = window.deriveKey(sigBytes);

        showStatus(statusEl, 'Computing HMAC...', 'info');
        var cryptoKey = await crypto.subtle.importKey(
            'raw', sharedKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        var messageBytes = new TextEncoder().encode(message);
        var hmacFull = await crypto.subtle.sign('HMAC', cryptoKey, messageBytes);
        var hmac16 = new Uint8Array(hmacFull).slice(0, 16);

        var payload = new Uint8Array(messageBytes.length + 16);
        payload.set(messageBytes, 0);
        payload.set(hmac16, messageBytes.length);

        var payloadHex = Array.from(payload).map(function(b) {
            return b.toString(16).padStart(2, '0');
        }).join('');

        console.log('Admin command payload:', message, '(' + payload.length + ' bytes)');

        showStatus(statusEl,
            'Payload ready (' + payload.length + ' bytes). ' +
            'OP_RETURN sending via OPWallet not yet implemented.<br>' +
            '<code style="word-break:break-all;">' + payloadHex + '</code>', 'info');

        _adminNonce = (function() {
            var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            var nonce = '';
            var rand = crypto.getRandomValues(new Uint8Array(3));
            for (var i = 0; i < 3; i++) nonce += chars[rand[i] % chars.length];
            return nonce;
        })();

    } catch (err) {
        console.error('Command error:', err);
        showStatus(statusEl, err.message || 'Failed to send command', 'error');
    } finally {
        setButtonLoading(btn, false);
        btn.textContent = 'Sign & Send Command';
    }
});

// ── Initialize ────────────────────────────────────────────────────────

console.log('Blockhost Signup Page loaded (OPNet)');
console.log('Config:', {
    serverPublicKey: CONFIG.serverPublicKey ? CONFIG.serverPublicKey.slice(0, 20) + '...' : 'NOT SET',
    rpcUrl: CONFIG.rpcUrl,
    nftContract: CONFIG.nftContract ? CONFIG.nftContract.slice(0, 20) + '...' : 'NOT SET',
    subscriptionContract: CONFIG.subscriptionContract ? CONFIG.subscriptionContract.slice(0, 20) + '...' : 'NOT SET',
});

loadPlans();
