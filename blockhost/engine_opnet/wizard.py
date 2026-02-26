"""
OPNet engine wizard plugin for BlockHost installer.

Provides:
- Flask Blueprint with /wizard/opnet route and blockchain API routes
- Pre-provisioner finalization steps: wallet, contracts, chain_config
- Post-nginx finalization steps: mint_nft, plan, revenue_share
- Summary data and template for the summary page
"""

import grp
import json
import os
import re
import secrets
import subprocess
import threading
from pathlib import Path
from typing import Optional

from flask import (
    Blueprint,
    current_app,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

blueprint = Blueprint(
    "engine_opnet",
    __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/engine_opnet/static",
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NETWORK_NAMES = {
    "testnet": "Testnet",
    "mainnet": "Bitcoin Mainnet",
}

NETWORK_RPC = {
    "testnet": "https://testnet.opnet.org",
    "mainnet": "https://mainnet.opnet.org",
}

# Default payment tokens per network (MOTO on testnet)
NETWORK_PAYMENT_TOKEN = {
    "testnet": "0x12aa57ada239a129c13a818ce23620243b727d22b871d561aafa3bdb23e9d68e",
    "mainnet": "",
}

CONFIG_DIR = Path("/etc/blockhost")

# OPNet JSON-RPC path (appended to base URL for direct HTTP calls)
RPC_PATH = "/api/v1/json-rpc"


def _rpc_url(base_url: str) -> str:
    """Normalize an OPNet RPC base URL to the full JSON-RPC endpoint.

    The opnet npm package appends /api/v1/json-rpc automatically, but
    Python HTTP calls need the full URL.
    """
    url = base_url.rstrip("/")
    if "api/v1/json-rpc" in url:
        return url
    return url + RPC_PATH


# OPNet internal addresses: 0x + 64 hex (32-byte)
INTERNAL_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")

# Bitcoin bech32/bech32m addresses: bc1 (mainnet), tb1 (testnet), bcrt1 (regtest)
# OPNet P2OP addresses: op1 (mainnet), opt1 (testnet), opr1 (regtest)
BECH32_ADDRESS_RE = re.compile(r"^(bc|tb|bcrt|op|opt|opr)1[a-z0-9]{8,87}$")

# Async deploy jobs (module-level, shared across requests)
_deploy_jobs: dict = {}


# ---------------------------------------------------------------------------
# Address validation
# ---------------------------------------------------------------------------


def validate_address(address: str) -> bool:
    """Validate an OPNet address (0x + 64 hex) or Bitcoin bech32/bech32m address."""
    if not address or not isinstance(address, str):
        return False
    addr = address.strip()
    return bool(INTERNAL_ADDRESS_RE.match(addr) or BECH32_ADDRESS_RE.match(addr))


# ---------------------------------------------------------------------------
# Wizard Route
# ---------------------------------------------------------------------------


@blueprint.route("/wizard/opnet", methods=["GET", "POST"])
def wizard_opnet():
    """OPNet blockchain configuration step."""
    if request.method == "POST":
        network = request.form.get("network", "testnet").strip()
        rpc_url = request.form.get("rpc_url", "").strip()
        if not rpc_url:
            rpc_url = NETWORK_RPC.get(network, NETWORK_RPC["testnet"])

        session["blockchain"] = {
            "network": network,
            "rpc_url": rpc_url,
            "wallet_mode": request.form.get("wallet_mode", "generate"),
            "deployer_mnemonic": request.form.get("deployer_mnemonic", "").strip(),
            "deployer_address": request.form.get("deployer_address", "").strip(),
            "deployer_internal_address": request.form.get("deployer_internal_address", "").strip(),
            "contract_mode": request.form.get("contract_mode", "deploy"),
            "nft_contract": request.form.get("nft_contract", "").strip(),
            "subscription_contract": request.form.get(
                "subscription_contract", ""
            ).strip(),
            "payment_token": request.form.get("payment_token", "").strip()
                or NETWORK_PAYMENT_TOKEN.get(network, ""),
            "plan_name": request.form.get("plan_name", "Basic VM").strip(),
            "plan_price_cents": int(request.form.get("plan_price_cents", 50)),
            "revenue_share_enabled": request.form.get("revenue_share_enabled") == "on",
            "revenue_share_percent": float(
                request.form.get("revenue_share_percent", 1.0)
            ),
            "revenue_share_dev": request.form.get("revenue_share_dev") == "on",
            "revenue_share_broker": request.form.get("revenue_share_broker") == "on",
        }

        # Navigate to next wizard step
        try:
            nav = current_app.jinja_env.globals.get("wizard_nav")
            if nav:
                next_info = nav("opnet")
                if next_info and next_info.get("next"):
                    return redirect(url_for(next_info["next"]))
        except Exception:
            pass
        return redirect(url_for("wizard_ipv6"))

    return render_template(
        "engine_opnet/blockchain.html",
        network_names=NETWORK_NAMES,
        network_rpc=NETWORK_RPC,
        network_payment_token=NETWORK_PAYMENT_TOKEN,
        blockchain=session.get("blockchain", {}),
    )


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------


@blueprint.route("/api/blockchain/generate-wallet", methods=["POST"])
def api_generate_wallet():
    """Generate a new OPNet wallet (mnemonic-based).

    Uses bhcrypt keygen CLI (bundled with engine package).
    Returns mnemonic phrase and P2TR address.
    """
    blockchain = session.get("blockchain", {})
    network = blockchain.get("network", "testnet")

    try:
        result = subprocess.run(
            ["bhcrypt", "keygen", "--network", network],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            return jsonify({"error": f"Wallet generation failed: {result.stderr.strip()}"}), 500

        data = json.loads(result.stdout.strip())
        return jsonify({
            "mnemonic": data["mnemonic"],
            "address": data["address"],
            "internalAddress": data.get("internalAddress", ""),
        })
    except json.JSONDecodeError:
        return jsonify({"error": "Could not parse wallet output"}), 500
    except FileNotFoundError:
        return jsonify({"error": "bhcrypt not found — is blockhost-engine installed?"}), 500
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Wallet generation timed out"}), 500


@blueprint.route("/api/blockchain/validate-mnemonic", methods=["POST"])
def api_validate_mnemonic():
    """Validate a mnemonic phrase and return its P2TR address."""
    data = request.get_json()
    mnemonic_phrase = (data or {}).get("mnemonic", "").strip()

    if not mnemonic_phrase:
        return jsonify({"error": "Mnemonic phrase required"}), 400

    words = mnemonic_phrase.split()
    if len(words) not in (12, 15, 18, 21, 24):
        return jsonify({"error": f"Invalid word count ({len(words)}), expected 12-24"}), 400

    # Validate mnemonic contains only safe characters (BIP39: lowercase words + spaces)
    if not re.match(r"^[a-z ]+$", mnemonic_phrase):
        return jsonify({"error": "Mnemonic must contain only lowercase words"}), 400

    blockchain = session.get("blockchain", {})
    network = blockchain.get("network", "testnet")

    try:
        result = subprocess.run(
            ["bhcrypt", "validate-mnemonic", "--network", network],
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "MNEMONIC": mnemonic_phrase},
        )

        if result.returncode == 0 and result.stdout.strip():
            addr_data = json.loads(result.stdout.strip())
            return jsonify({
                "address": addr_data["address"],
                "internalAddress": addr_data.get("internalAddress", ""),
                "mnemonic": mnemonic_phrase,
            })
        else:
            return jsonify({"error": result.stderr.strip() or "Invalid mnemonic"}), 400
    except FileNotFoundError:
        return jsonify({"error": "bhcrypt not found — is blockhost-engine installed?"}), 500
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Validation timed out"}), 500


@blueprint.route("/api/blockchain/balance")
def api_balance():
    """Check wallet BTC balance via OPNet RPC."""
    address = request.args.get("address", "").strip()
    rpc_url = request.args.get("rpc_url", "").strip()

    if not address or not rpc_url:
        return jsonify({"error": "address and rpc_url required"}), 400

    import urllib.request
    import urllib.error

    try:
        payload = json.dumps({
            "jsonrpc": "2.0",
            "method": "btc_getBalance",
            "params": [address, True],
            "id": 1,
        }).encode("utf-8")

        req = urllib.request.Request(
            _rpc_url(rpc_url),
            data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "BlockHost-Installer/1.0",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))

        if "error" in data:
            return jsonify({"error": data["error"].get("message", "RPC error")}), 400

        balance_sats = int(data.get("result", "0"), 16) if isinstance(data.get("result"), str) else int(data.get("result", 0))
        balance_btc = balance_sats / 1e8

        return jsonify({
            "balance_sats": str(balance_sats),
            "balance_btc": f"{balance_btc:.8f}",
            "has_funds": balance_sats > 0,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@blueprint.route("/api/blockchain/block-info")
def api_block_info():
    """Get current block height and time since last block."""
    rpc_url = request.args.get("rpc_url", "").strip()
    if not rpc_url:
        return jsonify({"error": "rpc_url required"}), 400

    import urllib.request
    import time

    try:
        # Get block number
        payload = json.dumps({
            "jsonrpc": "2.0",
            "method": "btc_blockNumber",
            "params": [],
            "id": 1,
        }).encode("utf-8")

        req = urllib.request.Request(
            _rpc_url(rpc_url),
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))

        if "error" in data or "result" not in data:
            return jsonify({"error": "Could not fetch block number"}), 500

        raw_height = data["result"]
        height = (
            int(raw_height, 16) if isinstance(raw_height, str) else int(raw_height)
        )

        # Get block details for timestamp
        block_time: Optional[int] = None
        try:
            payload2 = json.dumps({
                "jsonrpc": "2.0",
                "method": "btc_getBlockByNumber",
                "params": [raw_height, False],
                "id": 2,
            }).encode("utf-8")

            req2 = urllib.request.Request(
                _rpc_url(rpc_url),
                data=payload2,
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            with urllib.request.urlopen(req2, timeout=10) as resp2:
                data2 = json.loads(resp2.read().decode("utf-8"))

            blk = data2.get("result")
            if blk:
                # Try common timestamp field names
                for key in ("timestamp", "time", "medianTime"):
                    ts = blk.get(key)
                    if ts is not None:
                        block_time = (
                            int(ts, 16) if isinstance(ts, str) else int(ts)
                        )
                        break
        except Exception:
            pass

        result: dict = {"height": height}
        if block_time is not None:
            result["block_time"] = block_time
            result["block_age_secs"] = int(time.time()) - block_time

        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@blueprint.route("/api/blockchain/tx-status")
def api_tx_status():
    """Check transaction confirmation status."""
    txid = request.args.get("txid", "").strip()
    rpc_url = request.args.get("rpc_url", "").strip()

    if not txid or not rpc_url:
        return jsonify({"error": "txid and rpc_url required"}), 400

    import urllib.request

    try:
        payload = json.dumps({
            "jsonrpc": "2.0",
            "method": "btc_getTransactionReceipt",
            "params": [txid],
            "id": 1,
        }).encode("utf-8")

        req = urllib.request.Request(
            _rpc_url(rpc_url),
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))

        receipt = data.get("result")
        if receipt and receipt.get("blockNumber"):
            raw_bn = receipt["blockNumber"]
            block_num = (
                int(raw_bn, 16) if isinstance(raw_bn, str) else int(raw_bn)
            )
            return jsonify({"status": "confirmed", "block": block_num})

        return jsonify({"status": "pending"})
    except Exception:
        return jsonify({"status": "unknown"})


@blueprint.route("/api/blockchain/deploy", methods=["POST"])
def api_deploy():
    """Start async contract deployment."""
    data = request.get_json() or {}
    deployer_mnemonic = data.get("deployer_mnemonic", "").strip()
    rpc_url = data.get("rpc_url", "").strip()
    payment_token = data.get("payment_token", "").strip()

    if not deployer_mnemonic or not rpc_url:
        return jsonify({"error": "deployer_mnemonic and rpc_url required"}), 400
    if not payment_token:
        return jsonify({"error": "payment_token required for subscription contract deployment"}), 400

    job_id = f"deploy-{secrets.token_hex(4)}"
    _deploy_jobs[job_id] = {
        "status": "running",
        "message": "Starting contract deployment...",
        "nft_contract": None,
        "subscription_contract": None,
    }

    thread = threading.Thread(
        target=_run_deploy,
        args=(job_id, deployer_mnemonic, rpc_url, payment_token),
    )
    thread.start()

    return jsonify({"job_id": job_id})


@blueprint.route("/api/blockchain/deploy-status/<job_id>")
def api_deploy_status(job_id):
    """Poll deployment status."""
    job = _deploy_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@blueprint.route("/api/blockchain/set-contracts", methods=["POST"])
def api_set_contracts():
    """Store existing contract addresses in session."""
    data = request.get_json() or {}
    nft = data.get("nft_contract", "").strip()
    sub = data.get("subscription_contract", "").strip()

    if nft and not validate_address(nft):
        return jsonify({"error": "Invalid NFT contract address (0x + 64 hex)"}), 400
    if sub and not validate_address(sub):
        return jsonify({"error": "Invalid subscription contract address (0x + 64 hex)"}), 400

    blockchain = session.get("blockchain", {})
    if nft:
        blockchain["nft_contract"] = nft
    if sub:
        blockchain["subscription_contract"] = sub
    session["blockchain"] = blockchain

    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Deploy helper (runs in background thread)
# ---------------------------------------------------------------------------


def _run_deploy(
    job_id: str,
    deployer_mnemonic: str,
    rpc_url: str,
    payment_token: str,
):
    """Deploy NFT and subscription contracts in background."""
    job = _deploy_jobs[job_id]

    try:
        # Write mnemonic for the deploy script
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        mnemonic_file = CONFIG_DIR / "deployer.key"
        mnemonic_file.write_text(deployer_mnemonic)
        _set_blockhost_ownership(mnemonic_file, 0o640)

        env = {
            **os.environ,
            "OPNET_MNEMONIC": deployer_mnemonic,
            "OPNET_RPC_URL": rpc_url,
        }
        if payment_token:
            env["OPNET_PAYMENT_TOKEN"] = payment_token

        deploy_script = Path("/usr/bin/blockhost-deploy-contracts")
        if not deploy_script.exists():
            # Development fallback
            dev_script = Path("/opt/blockhost/scripts/deploy-contracts")
            if dev_script.exists():
                deploy_script = dev_script

        if not deploy_script.exists():
            job["status"] = "failed"
            job["message"] = "blockhost-deploy-contracts not found"
            return

        job["message"] = "Deploying contracts..."
        result = subprocess.run(
            [str(deploy_script)],
            capture_output=True,
            text=True,
            timeout=600,
            env=env,
        )

        if result.returncode != 0:
            job["status"] = "failed"
            job["message"] = f"Deployment failed: {result.stderr or result.stdout}"
            return

        # Parse pubkeys from stdout (one per line, 0x-prefixed)
        pubkeys = [
            line.strip()
            for line in result.stdout.strip().split("\n")
            if line.strip().startswith("0x")
        ]

        if len(pubkeys) >= 2:
            job["nft_contract"] = pubkeys[0]
            job["subscription_contract"] = pubkeys[1]
            job["status"] = "completed"
            job["message"] = "Contracts deployed successfully"
        elif len(pubkeys) == 1:
            job["nft_contract"] = pubkeys[0]
            job["status"] = "completed"
            job["message"] = "NFT contract deployed (subscription may need payment token)"
        else:
            job["status"] = "failed"
            job["message"] = f"Could not parse contract pubkeys from output: {result.stdout}"

    except subprocess.TimeoutExpired:
        job["status"] = "failed"
        job["message"] = "Deployment timed out (10 minutes)"
    except Exception as e:
        job["status"] = "failed"
        job["message"] = str(e)


# ---------------------------------------------------------------------------
# Summary & UI
# ---------------------------------------------------------------------------


def get_ui_params(session_data: dict) -> dict:
    """Return OPNet-specific UI parameters for wizard templates."""
    blockchain = session_data.get("blockchain", {})
    network = blockchain.get("network", "testnet")
    return {
        "network_name": NETWORK_NAMES.get(network, network),
        "network": network,
    }


def get_wallet_template() -> str:
    """Return the template name for the engine wallet connection page."""
    return "engine_opnet/wallet.html"


def validate_signature(sig: str) -> bool:
    """Validate signature format (0x-prefixed hex)."""
    return bool(sig and sig.startswith("0x"))


def decrypt_config(signature: str, ciphertext: str) -> dict:
    """Decrypt config backup using bhcrypt.

    Args:
        signature: Admin wallet signature (0x-prefixed hex)
        ciphertext: Encrypted config file content (0x-prefixed hex)

    Returns:
        Parsed config dict

    Raises:
        ValueError: On decryption failure or invalid content
        FileNotFoundError: If bhcrypt not installed
    """
    import yaml

    if not ciphertext.startswith("0x"):
        raise ValueError("Invalid config file (expected hex ciphertext)")

    result = subprocess.run(
        [
            "bhcrypt", "decrypt-symmetric",
            "--signature", signature,
            "--ciphertext", ciphertext,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise ValueError("Decryption failed — wrong wallet or corrupted file")

    config = yaml.safe_load(result.stdout)
    if not isinstance(config, dict):
        raise ValueError("Decrypted content is not valid config")
    return config


def encrypt_config(signature: str, plaintext: str) -> str:
    """Encrypt config for backup download using bhcrypt.

    Args:
        signature: Admin wallet signature (0x-prefixed hex)
        plaintext: YAML-serialized config string

    Returns:
        Hex ciphertext string (0x-prefixed)

    Raises:
        ValueError: On encryption failure
        FileNotFoundError: If bhcrypt not installed
    """
    result = subprocess.run(
        [
            "bhcrypt", "encrypt-symmetric",
            "--signature", signature,
            "--plaintext", plaintext,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise ValueError(f"Encryption failed: {result.stderr}")

    output = result.stdout.strip()
    if not output.startswith("0x"):
        raise ValueError("Could not parse encrypted output")
    return output


def get_summary_data(session_data: dict) -> dict:
    """Return blockchain summary data for the summary page."""
    blockchain = session_data.get("blockchain", {})
    network = blockchain.get("network", "testnet")
    return {
        "network_name": NETWORK_NAMES.get(network, network),
        "network": network,
        "rpc_url": blockchain.get("rpc_url", ""),
        "deployer_address": blockchain.get("deployer_address", ""),
        "contract_mode": blockchain.get("contract_mode", "deploy"),
        "nft_contract": blockchain.get("nft_contract", ""),
        "subscription_contract": blockchain.get("subscription_contract", ""),
        "payment_token": blockchain.get("payment_token", ""),
        "plan_name": blockchain.get("plan_name", "Basic VM"),
        "plan_price_cents": blockchain.get("plan_price_cents", 50),
        "revenue_share_enabled": blockchain.get("revenue_share_enabled", False),
    }


def get_summary_template() -> str:
    """Return the template name for the engine summary section."""
    return "engine_opnet/summary_section.html"


def get_progress_steps_meta() -> list[dict]:
    """Return step metadata for the progress UI."""
    pre = [
        {"id": "wallet", "label": "Setting up deployer wallet"},
        {"id": "contracts", "label": "Deploying smart contracts"},
        {"id": "chain_config", "label": "Writing configuration files"},
    ]
    post = [
        {"id": "mint_nft", "label": "Minting admin credential NFT"},
        {"id": "plan", "label": "Creating subscription plan"},
        {"id": "revenue_share", "label": "Configuring revenue sharing"},
    ]
    return pre + post


# ---------------------------------------------------------------------------
# Finalization Steps (pre-provisioner)
# ---------------------------------------------------------------------------


def get_finalization_steps() -> list[tuple]:
    """Return pre-provisioner finalization steps.

    Each tuple: (step_id, display_name, callable[, hint])
    """
    return [
        ("wallet", "Setting up deployer wallet", finalize_wallet),
        (
            "contracts",
            "Deploying smart contracts",
            finalize_contracts,
            "(may take several minutes — two-phase Bitcoin transactions)",
        ),
        ("chain_config", "Writing configuration files", finalize_chain_config),
    ]


def get_post_finalization_steps() -> list[tuple]:
    """Return post-nginx finalization steps.

    These run after provisioner, ipv6, https, signup, and nginx steps.
    """
    return [
        ("revenue_share", "Configuring revenue sharing", finalize_revenue_share),
        ("mint_nft", "Minting admin credential NFT", finalize_mint_nft),
        ("plan", "Creating subscription plan", finalize_plan),
    ]


# ---------------------------------------------------------------------------
# Helpers (private)
# ---------------------------------------------------------------------------


def _set_blockhost_ownership(path, mode=0o640):
    """Set file to root:blockhost with given mode."""
    try:
        from installer.web.utils import set_blockhost_ownership

        set_blockhost_ownership(path, mode)
    except ImportError:
        os.chmod(str(path), mode)
        try:
            gid = grp.getgrnam("blockhost").gr_gid
            os.chown(str(path), 0, gid)
        except KeyError:
            pass


def _write_yaml(path: Path, data: dict):
    """Write data to YAML file."""
    try:
        from installer.web.utils import write_yaml

        write_yaml(path, data)
    except ImportError:
        try:
            import yaml

            path.write_text(yaml.safe_dump(data, default_flow_style=False))
        except ImportError:
            # Minimal fallback
            lines: list[str] = []
            _dict_to_yaml(data, lines, 0)
            path.write_text("\n".join(lines) + "\n")


def _dict_to_yaml(data: dict, lines: list, indent: int):
    """Simple dict to YAML converter."""
    prefix = "  " * indent
    for key, value in data.items():
        if isinstance(value, dict):
            lines.append(f"{prefix}{key}:")
            _dict_to_yaml(value, lines, indent + 1)
        elif isinstance(value, list):
            lines.append(f"{prefix}{key}:")
            for item in value:
                if isinstance(item, dict):
                    lines.append(f"{prefix}  -")
                    _dict_to_yaml(item, lines, indent + 2)
                else:
                    lines.append(f"{prefix}  - {item}")
        elif value is None:
            lines.append(f"{prefix}{key}: null")
        elif isinstance(value, bool):
            lines.append(f"{prefix}{key}: {str(value).lower()}")
        elif isinstance(value, (int, float)):
            lines.append(f"{prefix}{key}: {value}")
        else:
            lines.append(f'{prefix}{key}: "{value}"')


def _discover_bridge() -> str:
    """Read bridge name from first-boot marker or scan /sys/class/net."""
    bridge_file = Path("/run/blockhost/bridge")
    if bridge_file.exists():
        name = bridge_file.read_text().strip()
        if name:
            return name
    for p in Path("/sys/class/net").iterdir():
        if (p / "bridge").is_dir():
            return p.name
    return "br0"


def _bw_env(blockchain: dict) -> dict:
    """Build environment for bw CLI calls."""
    return {
        **os.environ,
        "BLOCKHOST_CONFIG_DIR": str(CONFIG_DIR),
    }


# ---------------------------------------------------------------------------
# Pre-finalization step functions
# ---------------------------------------------------------------------------


def finalize_wallet(config: dict) -> tuple[bool, Optional[str]]:
    """Write deployer mnemonic to /etc/blockhost/deployer.key.

    Idempotent: skips write if file exists with matching content.
    """
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        blockchain = config.get("blockchain", {})
        mnemonic = blockchain.get("deployer_mnemonic", "")

        if not mnemonic:
            return False, "No deployer mnemonic in configuration"

        words = mnemonic.split()
        if len(words) not in (12, 15, 18, 21, 24):
            return False, f"Invalid mnemonic word count ({len(words)})"

        mnemonic_file = CONFIG_DIR / "deployer.key"

        # Idempotent: skip if same mnemonic already written
        if mnemonic_file.exists() and mnemonic_file.read_text().strip() == mnemonic:
            config["_step_result_wallet"] = {
                "address": blockchain.get("deployer_address", ""),
            }
            return True, None

        mnemonic_file.write_text(mnemonic)
        _set_blockhost_ownership(mnemonic_file, 0o640)

        config["_step_result_wallet"] = {
            "address": blockchain.get("deployer_address", ""),
        }
        return True, None
    except Exception as e:
        return False, str(e)


def finalize_contracts(config: dict) -> tuple[bool, Optional[str]]:
    """Deploy or verify smart contracts.

    For contract_mode == 'deploy': use blockhost-deploy-contracts.
    For contract_mode == 'existing': verify contracts exist via `is contract`.

    Idempotent: skips deployment if contracts already recorded in config.
    """
    try:
        blockchain = config.get("blockchain", {})
        contract_mode = blockchain.get("contract_mode", "deploy")
        rpc_url = blockchain.get("rpc_url", "")

        if contract_mode == "existing":
            nft = blockchain.get("nft_contract", "")
            sub = blockchain.get("subscription_contract", "")

            if not nft or not sub:
                return False, "Contract addresses required for existing mode"

            for label, addr in [("NFT", nft), ("Subscription", sub)]:
                if not validate_address(addr):
                    return False, f"Invalid {label} address: {addr}"
                ok = _verify_contract_exists(addr)
                if not ok:
                    return False, f"{label} contract not found at {addr}"

            config["_step_result_contracts"] = {
                "nft_contract": nft,
                "subscription_contract": sub,
            }
            return True, None

        # Deploy mode
        nft = blockchain.get("nft_contract", "")
        sub = blockchain.get("subscription_contract", "")
        if nft and sub:
            # Already deployed (idempotent)
            config["_step_result_contracts"] = {
                "nft_contract": nft,
                "subscription_contract": sub,
            }
            return True, None

        mnemonic = blockchain.get("deployer_mnemonic", "")
        mnemonic_file = CONFIG_DIR / "deployer.key"
        if not mnemonic_file.exists():
            if mnemonic:
                mnemonic_file.write_text(mnemonic)
                _set_blockhost_ownership(mnemonic_file, 0o640)
            else:
                return False, "Deployer mnemonic not available"

        payment_token = blockchain.get("payment_token", "")
        if not payment_token:
            return False, (
                "Payment token address required for contract deployment. "
                "Go back to the blockchain step and enter the OP_20 "
                "stablecoin address."
            )

        env = {
            **os.environ,
            "OPNET_MNEMONIC": mnemonic,
            "OPNET_RPC_URL": rpc_url,
        }
        if payment_token:
            env["OPNET_PAYMENT_TOKEN"] = payment_token

        deploy_script = Path("/usr/bin/blockhost-deploy-contracts")
        if not deploy_script.exists():
            dev_script = Path("/opt/blockhost/scripts/deploy-contracts")
            if dev_script.exists():
                deploy_script = dev_script
            else:
                return False, "blockhost-deploy-contracts not found"

        result = subprocess.run(
            [str(deploy_script)],
            capture_output=True,
            text=True,
            timeout=600,
            env=env,
        )

        if result.returncode != 0:
            return False, f"Contract deployment failed: {result.stderr or result.stdout}"

        pubkeys = [
            line.strip()
            for line in result.stdout.strip().split("\n")
            if line.strip().startswith("0x")
        ]

        if len(pubkeys) >= 2:
            blockchain["nft_contract"] = pubkeys[0]
            blockchain["subscription_contract"] = pubkeys[1]
            config["blockchain"] = blockchain
            config["_step_result_contracts"] = {
                "nft_contract": pubkeys[0],
                "subscription_contract": pubkeys[1],
            }
            return True, None

        return False, f"Expected 2 contract pubkeys, got {len(pubkeys)}"

    except subprocess.TimeoutExpired:
        return False, "Contract deployment timed out (10 minutes)"
    except Exception as e:
        return False, str(e)


def _verify_contract_exists(address: str) -> bool:
    """Check if a contract exists at the given address."""
    try:
        result = subprocess.run(
            ["is", "contract", address],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def finalize_chain_config(config: dict) -> tuple[bool, Optional[str]]:
    """Write all blockchain configuration files.

    Files written:
    - web3-defaults.yaml (RPC, contracts, payment token, DEX addresses)
    - blockhost.yaml (server, admin, provisioner config)
    - admin-commands.json
    """
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        var_dir = Path("/var/lib/blockhost")
        var_dir.mkdir(parents=True, exist_ok=True)

        blockchain = config.get("blockchain", {})
        provisioner = config.get("provisioner", {})
        rpc_url = blockchain.get("rpc_url", "")
        nft_contract = blockchain.get("nft_contract", "")
        sub_contract = blockchain.get("subscription_contract", "")
        payment_token = blockchain.get("payment_token", "")
        admin_wallet = config.get("admin_wallet", "")

        deployer_address = blockchain.get("deployer_address", "")

        # Read server public key
        server_pubkey = ""
        pubkey_file = CONFIG_DIR / "server.pubkey"
        if pubkey_file.exists():
            server_pubkey = pubkey_file.read_text().strip()

        bridge = provisioner.get("bridge") or _discover_bridge()

        # --- web3-defaults.yaml ---
        web3_config: dict = {
            "blockchain": {
                "rpc_url": rpc_url,
                "nft_contract": nft_contract,
                "subscription_contract": sub_contract,
                "payment_token": payment_token,
                "chain_id": blockchain.get("chain_id", ""),
                "server_public_key": server_pubkey,
            },
        }

        web3_path = CONFIG_DIR / "web3-defaults.yaml"
        if web3_path.exists():
            try:
                import yaml

                existing = yaml.safe_load(web3_path.read_text()) or {}
                for section, values in web3_config.items():
                    if isinstance(values, dict) and isinstance(
                        existing.get(section), dict
                    ):
                        existing[section].update(values)
                    else:
                        existing[section] = values
                web3_config = existing
            except ImportError:
                pass
        _write_yaml(web3_path, web3_config)
        _set_blockhost_ownership(web3_path, 0o640)

        # --- blockhost.yaml ---
        public_secret = config.get("admin_public_secret", "blockhost-access")
        bh_config: dict = {
            "server": {
                "address": deployer_address,
                "key_file": "/etc/blockhost/deployer.key",
            },
            "server_public_key": server_pubkey,
            "public_secret": public_secret,
            "contract_address": sub_contract,
        }

        if provisioner:
            bh_config["provisioner"] = {
                "node": provisioner.get("node", ""),
                "bridge": provisioner.get("bridge", bridge),
                "vmid_start": provisioner.get("vmid_start", 100),
                "vmid_end": provisioner.get("vmid_end", 999),
                "gc_grace_days": provisioner.get("gc_grace_days", 7),
            }

        admin_commands = config.get("admin_commands", {})
        bh_config["admin"] = {
            "wallet_address": admin_wallet,
            "credential_nft_id": 0,
            "max_command_age": 300,
        }

        if admin_commands.get("enabled"):
            bh_config["admin"]["destination_mode"] = admin_commands.get(
                "destination_mode", "self"
            )

        bh_path = CONFIG_DIR / "blockhost.yaml"
        _write_yaml(bh_path, bh_config)
        _set_blockhost_ownership(bh_path, 0o640)

        # --- admin-commands.json ---
        if admin_commands.get("enabled") and admin_commands.get("knock_command"):
            commands_db = {
                "commands": {
                    admin_commands["knock_command"]: {
                        "action": "knock",
                        "description": "Open configured ports temporarily",
                        "params": {
                            "allowed_ports": admin_commands.get("knock_ports", [22]),
                            "default_duration": admin_commands.get(
                                "knock_timeout", 300
                            ),
                        },
                    }
                }
            }
            cmd_path = CONFIG_DIR / "admin-commands.json"
            cmd_path.write_text(json.dumps(commands_db, indent=2) + "\n")
            _set_blockhost_ownership(cmd_path, 0o640)

        # --- admin-signature.key ---
        admin_signature = config.get("admin_signature", "")
        if admin_signature:
            sig_file = CONFIG_DIR / "admin-signature.key"
            sig_file.write_text(admin_signature)
            _set_blockhost_ownership(sig_file, 0o640)

        # --- .env ---
        opt_dir = Path("/opt/blockhost")
        opt_dir.mkdir(parents=True, exist_ok=True)
        env_lines = [
            f"RPC_URL={rpc_url}",
            f"BLOCKHOST_CONTRACT={sub_contract}",
            f"NFT_CONTRACT={nft_contract}",
            f"DEPLOYER_KEY_FILE=/etc/blockhost/deployer.key",
        ]
        env_path = opt_dir / ".env"
        env_path.write_text("\n".join(env_lines) + "\n")
        _set_blockhost_ownership(env_path, 0o640)

        # --- Initialize vms.json if missing ---
        vms_path = var_dir / "vms.json"
        if not vms_path.exists():
            vms_path.write_text(
                json.dumps(
                    {
                        "vms": {},
                        "next_vmid": provisioner.get("vmid_start", 100),
                        "allocated_ips": [],
                        "allocated_ipv6": [],
                    },
                    indent=2,
                )
            )

        config["_step_result_chain_config"] = {
            "message": "Configuration files written"
        }
        return True, None
    except Exception as e:
        return False, str(e)


# ---------------------------------------------------------------------------
# Post-finalization step functions
# ---------------------------------------------------------------------------


def _bech32_to_opnet_address(address: str) -> Optional[str]:
    """Convert a P2TR bech32m address to 0x-prefixed 32-byte OPNet address.

    The witness program of a P2TR address is the 32-byte x-only tweaked pubkey,
    which is the OPNet internal address. No RPC needed — pure bech32 decode.
    Returns None if not a valid P2TR address.
    """
    try:
        import segwit_addr  # type: ignore[import]
        _, witness_version, witness_program = segwit_addr.decode(None, address)
        if witness_version == 1 and len(witness_program) == 32:
            return "0x" + bytes(witness_program).hex()
    except Exception:
        pass
    # Fallback: manual bech32m decode using Python standard library
    try:
        from hashlib import sha256 as _  # noqa — just checking stdlib available
        # bech32m charset
        CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
        addr = address.lower()
        sep = addr.rfind("1")
        if sep < 1:
            return None
        data_chars = addr[sep + 1:]
        decoded = []
        for c in data_chars:
            v = CHARSET.find(c)
            if v < 0:
                return None
            decoded.append(v)
        # Strip 6-char checksum
        if len(decoded) < 7:
            return None
        decoded = decoded[:-6]
        # First element is witness version
        witness_version = decoded[0]
        if witness_version != 1:
            return None
        # Convert from 5-bit groups to 8-bit bytes
        bits = 0
        value = 0
        result = []
        for v in decoded[1:]:
            value = (value << 5) | v
            bits += 5
            if bits >= 8:
                bits -= 8
                result.append((value >> bits) & 0xFF)
        if len(result) == 32:
            return "0x" + bytes(result).hex()
    except Exception:
        pass
    return None


def finalize_mint_nft(config: dict) -> tuple[bool, Optional[str]]:
    """Mint admin credential NFT #0.

    For fresh deploys: mint via blockhost-mint-nft CLI.
    For pre-deployed contracts: check if NFT exists, update if needed.
    """
    try:
        blockchain = config.get("blockchain", {})
        admin_wallet = config.get("admin_wallet", "")

        if not admin_wallet:
            return False, "Admin wallet address not configured"

        if not validate_address(admin_wallet):
            return False, "Invalid admin wallet address"

        # blockhost-mint-nft requires 0x + 64 hex (OPNet internal address).
        # The wallet page submits a bech32m P2TR address — convert if needed.
        if not admin_wallet.startswith("0x"):
            resolved = _bech32_to_opnet_address(admin_wallet)
            if not resolved:
                return False, f"--owner-wallet must be 0x + 64 hex characters (32-byte OPNet address), got: {admin_wallet}"
            admin_wallet = resolved

        # Build encrypted connection details for the NFT
        user_encrypted = ""
        admin_signature = config.get("admin_signature", "")
        https_cfg = config.get("https", {})
        if not https_cfg:
            https_file = CONFIG_DIR / "https.json"
            if https_file.exists():
                https_cfg = json.loads(https_file.read_text())
        server_addr = https_cfg.get("ipv6_address") or https_cfg.get("hostname", "")

        if server_addr and admin_signature:
            # Encrypt connection details using bhcrypt CLI
            connection_details = json.dumps({
                "hostname": server_addr,
                "port": 22,
                "username": "admin",
            })
            try:
                result = subprocess.run(
                    [
                        "bhcrypt", "encrypt-symmetric",
                        "--signature", admin_signature,
                        "--plaintext", connection_details,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if result.returncode == 0 and result.stdout.strip():
                    user_encrypted = result.stdout.strip()
            except (FileNotFoundError, subprocess.TimeoutExpired):
                pass

        # Check if NFT #0 already exists (pre-deployed contracts)
        if blockchain.get("contract_mode") == "existing":
            try:
                result = subprocess.run(
                    ["is", admin_wallet, "0"],
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                if result.returncode == 0:
                    # NFT exists — update userEncrypted if we have it
                    if user_encrypted:
                        subprocess.run(
                            ["bw", "set", "encrypt", "0", user_encrypted],
                            capture_output=True,
                            text=True,
                            timeout=60,
                            env=_bw_env(blockchain),
                        )
                    config["_step_result_mint_nft"] = {
                        "token_id": 0,
                        "owner": admin_wallet,
                    }
                    return True, None
            except FileNotFoundError:
                pass

        # Mint NFT #0 via CLI — deployer's own OPNet address is the owner
        cmd = [
            "blockhost-mint-nft",
        ]
        if user_encrypted:
            cmd.extend(["--user-encrypted", user_encrypted])

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            return False, f"NFT minting failed: {result.stderr or result.stdout}"

        # stdout is the token ID
        token_id = result.stdout.strip()
        config["_step_result_mint_nft"] = {
            "token_id": int(token_id) if token_id.isdigit() else 0,
            "owner": admin_wallet,
        }
        return True, None
    except subprocess.TimeoutExpired:
        return False, "NFT minting timed out"
    except Exception as e:
        return False, str(e)


def finalize_plan(config: dict) -> tuple[bool, Optional[str]]:
    """Set payment token and create default subscription plan via bw CLI."""
    try:
        blockchain = config.get("blockchain", {})
        plan_name = blockchain.get("plan_name", "Basic VM")
        plan_price = blockchain.get("plan_price_cents", 50)
        payment_token = blockchain.get("payment_token", "")

        env = _bw_env(blockchain)

        # Set payment token on contract (OPNet equivalent of setPrimaryStablecoin)
        if payment_token:
            result = subprocess.run(
                ["bw", "config", "stable", payment_token],
                capture_output=True,
                text=True,
                timeout=120,
                env=env,
            )
            if result.returncode != 0:
                return False, f"Failed to set payment token: {result.stderr or result.stdout}"

        # Create plan
        result = subprocess.run(
            ["bw", "plan", "create", plan_name, str(plan_price)],
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
        )

        if result.returncode != 0:
            return False, f"Plan creation failed: {result.stderr or result.stdout}"

        config["_step_result_plan"] = {
            "plan_name": plan_name,
            "price": f"{plan_price} cents/day",
        }
        return True, None
    except FileNotFoundError:
        return False, "bw CLI not found"
    except subprocess.TimeoutExpired:
        return False, "Plan creation timed out"
    except Exception as e:
        return False, str(e)


def finalize_revenue_share(config: dict) -> tuple[bool, Optional[str]]:
    """Write addressbook.json and revenue-share.json. Enable blockhost-monitor."""
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        blockchain = config.get("blockchain", {})
        admin_wallet = config.get("admin_wallet", "")

        # Addressbook needs 0x internal addresses, not bech32m P2OP addresses.
        # Use deployer_internal_address (from keygen), falling back to bech32 decode.
        deployer_internal = (
            blockchain.get("deployer_internal_address", "")
            or _bech32_to_opnet_address(blockchain.get("deployer_address", ""))
            or ""
        )

        # Resolve admin_wallet to internal format if it's bech32m
        admin_internal = admin_wallet
        if admin_wallet and not admin_wallet.startswith("0x"):
            admin_internal = _bech32_to_opnet_address(admin_wallet) or admin_wallet

        # Build addressbook entries (0x internal addresses)
        addressbook: dict = {}

        if admin_internal:
            addressbook["admin"] = {"address": admin_internal}

        if deployer_internal:
            addressbook["server"] = {
                "address": deployer_internal,
                "keyfile": "/etc/blockhost/deployer.key",
            }

        if blockchain.get("revenue_share_dev"):
            addressbook["dev"] = {"address": admin_internal}

        if blockchain.get("revenue_share_broker"):
            addressbook["broker"] = {"address": admin_internal}

        # Try ab --init CLI first (pass 0x internal addresses)
        ab_init_used = False
        if admin_internal and deployer_internal:
            try:
                cmd = ["ab", "--init", admin_internal, deployer_internal]
                if blockchain.get("revenue_share_dev"):
                    cmd.append(admin_internal)
                if blockchain.get("revenue_share_broker"):
                    cmd.append(admin_internal)
                cmd.append("/etc/blockhost/deployer.key")

                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                ab_init_used = result.returncode == 0
            except FileNotFoundError:
                pass

        if not ab_init_used:
            ab_path = CONFIG_DIR / "addressbook.json"
            if not ab_path.exists() or not json.loads(ab_path.read_text() or "{}"):
                ab_path.write_text(json.dumps(addressbook, indent=2) + "\n")
                _set_blockhost_ownership(ab_path, 0o640)

        # Write revenue-share.json
        rev_enabled = blockchain.get("revenue_share_enabled", False)
        rev_percent = blockchain.get("revenue_share_percent", 1.0)
        recipients: list[dict] = []

        if rev_enabled:
            active_roles = [
                r for r in ["dev", "broker"]
                if blockchain.get(f"revenue_share_{r}")
            ]
            share_each = rev_percent / max(len(active_roles), 1)
            for role in active_roles:
                recipients.append({"role": role, "percent": share_each})

        rev_config = {
            "enabled": rev_enabled,
            "total_percent": rev_percent if rev_enabled else 0.0,
            "recipients": recipients,
        }

        rev_path = CONFIG_DIR / "revenue-share.json"
        rev_path.write_text(json.dumps(rev_config, indent=2) + "\n")
        _set_blockhost_ownership(rev_path, 0o640)

        # Enable blockhost-monitor service
        subprocess.run(
            ["systemctl", "enable", "blockhost-monitor"],
            capture_output=True,
            timeout=30,
        )

        config["_step_result_revenue_share"] = {
            "message": "Addressbook initialized"
        }
        return True, None
    except Exception as e:
        return False, str(e)
