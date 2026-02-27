"""
Root agent action: OPNet wallet generation.

Replaces the EVM `cast wallet new` handler with BIP39 mnemonic generation
and OPNet address derivation via the bundled keygen.js helper.
"""

import grp
import json
import os
import re

from _common import CONFIG_DIR, SHORT_NAME_RE, WALLET_DENY_NAMES, log

# keygen.js is bundled alongside this action plugin
_KEYGEN_JS = '/usr/share/blockhost/keygen.js'


def _read_network_from_config():
    """Read network name from web3-defaults.yaml."""
    try:
        import yaml
        cfg_path = CONFIG_DIR / 'web3-defaults.yaml'
        if cfg_path.exists():
            data = yaml.safe_load(cfg_path.read_text()) or {}
            rpc_url = data.get('blockchain', {}).get('rpc_url', '')
            if 'mainnet' in rpc_url:
                return 'mainnet'
    except Exception:
        pass
    return 'testnet'


def handle_generate_wallet(params):
    import subprocess

    name = params.get('name', '')
    if not SHORT_NAME_RE.match(name):
        return {'ok': False, 'error': f'Invalid wallet name: {name}'}
    if name in WALLET_DENY_NAMES:
        return {'ok': False, 'error': f'Reserved name: {name}'}

    keyfile = CONFIG_DIR / f'{name}.key'
    if keyfile.exists():
        return {'ok': False, 'error': f'Key file already exists: {keyfile}'}

    if not os.path.isfile(_KEYGEN_JS):
        return {'ok': False, 'error': f'keygen.js not found at {_KEYGEN_JS}'}

    # Generate mnemonic + derive OPNet address
    network = _read_network_from_config()
    try:
        result = subprocess.run(
            ['node', _KEYGEN_JS, network],
            capture_output=True, text=True, timeout=30,
        )
    except Exception as e:
        return {'ok': False, 'error': f'keygen.js failed: {e}'}

    if result.returncode != 0:
        return {'ok': False, 'error': f'keygen.js error: {result.stderr.strip()}'}

    try:
        keygen_out = json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        return {'ok': False, 'error': f'keygen.js invalid output: {result.stdout[:200]}'}

    mnemonic_phrase = keygen_out.get('mnemonic', '')
    address = keygen_out.get('address', '')

    if not mnemonic_phrase or not re.match(r'^0x[0-9a-fA-F]{64}$', address):
        return {'ok': False, 'error': f'keygen.js returned invalid data: {keygen_out}'}

    # Write mnemonic to keyfile
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    keyfile.write_text(mnemonic_phrase + '\n')

    gid = grp.getgrnam('blockhost').gr_gid
    os.chown(str(keyfile), 0, gid)
    os.chmod(str(keyfile), 0o640)

    # Update addressbook
    ab_file = CONFIG_DIR / 'addressbook.json'
    addressbook = {}
    if ab_file.exists():
        try:
            addressbook = json.loads(ab_file.read_text())
        except (json.JSONDecodeError, IOError):
            pass

    addressbook[name] = {'address': address, 'keyfile': str(keyfile)}
    ab_file.write_text(json.dumps(addressbook, indent=2) + '\n')
    os.chown(str(ab_file), 0, gid)
    os.chmod(str(ab_file), 0o640)

    log.info('Generated OPNet wallet %s: %s', name, address)
    return {'ok': True, 'address': address, 'keyfile': str(keyfile)}


ACTIONS = {
    'generate-wallet': handle_generate_wallet,
}
