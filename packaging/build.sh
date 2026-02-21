#!/bin/bash
# Build blockhost-engine-opnet .deb package
set -e

VERSION="0.1.0"
PKG_NAME="blockhost-engine-opnet_${VERSION}_all"
TEMPLATE_PKG_NAME="blockhost-auth-svc_${VERSION}_all"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PKG_DIR="$SCRIPT_DIR/$PKG_NAME"
TEMPLATE_PKG_DIR="$SCRIPT_DIR/$TEMPLATE_PKG_NAME"

echo "Building blockhost-engine-opnet v${VERSION}..."

# Clean up build artifacts on exit (success or failure)
cleanup() {
  rm -rf "$PKG_DIR"
  rm -rf "$TEMPLATE_PKG_DIR"
  rm -f "$SCRIPT_DIR/auth-svc.js"
}
trap cleanup EXIT

# Clean and recreate package directory
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR"/{DEBIAN,usr/bin,usr/share/blockhost/contracts,lib/systemd/system}

# ============================================
# Bundle TypeScript with esbuild
# ============================================
echo ""
echo "Bundling TypeScript with esbuild..."

# Install dependencies first (needed for bundling)
(cd "$PROJECT_DIR" && npm install --silent)

# Bundle the monitor into a single JS file
npx esbuild "$PROJECT_DIR/src/monitor/index.ts" \
    --bundle \
    --platform=node \
    --target=node22 \
    --minify \
    --outfile="$PKG_DIR/usr/share/blockhost/monitor.js"

if [ ! -f "$PKG_DIR/usr/share/blockhost/monitor.js" ]; then
    echo "ERROR: Failed to create monitor bundle"
    exit 1
fi

MONITOR_SIZE=$(du -h "$PKG_DIR/usr/share/blockhost/monitor.js" | cut -f1)
echo "Monitor bundle created: $MONITOR_SIZE"

# Bundle the bw CLI into a single JS file
echo "Bundling bw CLI with esbuild..."
npx esbuild "$PROJECT_DIR/src/bw/index.ts" \
    --bundle \
    --platform=node \
    --target=node22 \
    --minify \
    --outfile="$PKG_DIR/usr/share/blockhost/bw.js"

if [ ! -f "$PKG_DIR/usr/share/blockhost/bw.js" ]; then
    echo "ERROR: Failed to create bw CLI bundle"
    exit 1
fi

BW_SIZE=$(du -h "$PKG_DIR/usr/share/blockhost/bw.js" | cut -f1)
echo "bw CLI bundle created: $BW_SIZE"

# Create bw wrapper script
cat > "$PKG_DIR/usr/bin/bw" << 'BWEOF'
#!/bin/sh
export NODE_OPTIONS="--dns-result-order=ipv4first${NODE_OPTIONS:+ $NODE_OPTIONS}"
exec /usr/bin/node /usr/share/blockhost/bw.js "$@"
BWEOF
chmod 755 "$PKG_DIR/usr/bin/bw"

# Bundle the ab CLI into a single JS file
echo "Bundling ab CLI with esbuild..."
npx esbuild "$PROJECT_DIR/src/ab/index.ts" \
    --bundle \
    --platform=node \
    --target=node22 \
    --minify \
    --outfile="$PKG_DIR/usr/share/blockhost/ab.js"

if [ ! -f "$PKG_DIR/usr/share/blockhost/ab.js" ]; then
    echo "ERROR: Failed to create ab CLI bundle"
    exit 1
fi

AB_SIZE=$(du -h "$PKG_DIR/usr/share/blockhost/ab.js" | cut -f1)
echo "ab CLI bundle created: $AB_SIZE"

# Create ab wrapper script
cat > "$PKG_DIR/usr/bin/ab" << 'ABEOF'
#!/bin/sh
export NODE_OPTIONS="--dns-result-order=ipv4first${NODE_OPTIONS:+ $NODE_OPTIONS}"
exec /usr/bin/node /usr/share/blockhost/ab.js "$@"
ABEOF
chmod 755 "$PKG_DIR/usr/bin/ab"

# Bundle the is CLI into a single JS file
echo "Bundling is CLI with esbuild..."
npx esbuild "$PROJECT_DIR/src/is/index.ts" \
    --bundle \
    --platform=node \
    --target=node22 \
    --minify \
    --outfile="$PKG_DIR/usr/share/blockhost/is.js"

if [ ! -f "$PKG_DIR/usr/share/blockhost/is.js" ]; then
    echo "ERROR: Failed to create is CLI bundle"
    exit 1
fi

IS_SIZE=$(du -h "$PKG_DIR/usr/share/blockhost/is.js" | cut -f1)
echo "is CLI bundle created: $IS_SIZE"

# Create is wrapper script
cat > "$PKG_DIR/usr/bin/is" << 'ISEOF'
#!/bin/sh
export NODE_OPTIONS="--dns-result-order=ipv4first${NODE_OPTIONS:+ $NODE_OPTIONS}"
exec /usr/bin/node /usr/share/blockhost/is.js "$@"
ISEOF
chmod 755 "$PKG_DIR/usr/bin/is"

# Bundle bhcrypt CLI
echo "Bundling bhcrypt CLI with esbuild..."
npx esbuild "$PROJECT_DIR/src/bhcrypt/index.ts" \
    --bundle \
    --platform=node \
    --target=node22 \
    --minify \
    --outfile="$PKG_DIR/usr/share/blockhost/bhcrypt.js"

if [ ! -f "$PKG_DIR/usr/share/blockhost/bhcrypt.js" ]; then
    echo "ERROR: Failed to create bhcrypt CLI bundle"
    exit 1
fi

BHCRYPT_SIZE=$(du -h "$PKG_DIR/usr/share/blockhost/bhcrypt.js" | cut -f1)
echo "bhcrypt CLI bundle created: $BHCRYPT_SIZE"

# Create bhcrypt wrapper script
cat > "$PKG_DIR/usr/bin/bhcrypt" << 'BHEOF'
#!/bin/sh
export NODE_OPTIONS="--dns-result-order=ipv4first${NODE_OPTIONS:+ $NODE_OPTIONS}"
exec /usr/bin/node /usr/share/blockhost/bhcrypt.js "$@"
BHEOF
chmod 755 "$PKG_DIR/usr/bin/bhcrypt"

# ============================================
# Bundle auth-svc with esbuild
# ============================================
echo ""
echo "Bundling auth-svc with esbuild..."
npx esbuild "$PROJECT_DIR/src/auth-svc/index.ts" \
    --bundle \
    --platform=node \
    --target=node22 \
    --minify \
    --outfile="$SCRIPT_DIR/auth-svc.js"

if [ ! -f "$SCRIPT_DIR/auth-svc.js" ]; then
    echo "ERROR: Failed to create auth-svc bundle"
    exit 1
fi

AUTH_SVC_SIZE=$(du -h "$SCRIPT_DIR/auth-svc.js" | cut -f1)
echo "auth-svc bundle created: $AUTH_SVC_SIZE"

# ============================================
# Copy WASM contract artifacts
# ============================================
echo ""
echo "Copying WASM contract artifacts..."

SUBS_WASM="$PROJECT_DIR/contracts/blockhost-subscriptions/build/BlockhostSubscriptions.wasm"
SUBS_ABI="$PROJECT_DIR/contracts/blockhost-subscriptions/abis/BlockhostSubscriptions.abi.json"
NFT_WASM="$PROJECT_DIR/contracts/access-credential-nft/build/AccessCredentialNFT.wasm"
NFT_ABI="$PROJECT_DIR/contracts/access-credential-nft/abis/AccessCredentialNFT.abi.json"

for artifact in "$SUBS_WASM" "$SUBS_ABI" "$NFT_WASM" "$NFT_ABI"; do
    if [ -f "$artifact" ]; then
        cp "$artifact" "$PKG_DIR/usr/share/blockhost/contracts/"
        echo "  Copied: $(basename "$artifact")"
    else
        echo "  WARNING: Not found: $artifact"
    fi
done

# ============================================
# Create DEBIAN control files
# ============================================
echo ""
echo "Creating DEBIAN control files..."

# Create DEBIAN/control
cat > "$PKG_DIR/DEBIAN/control" << EOF
Package: blockhost-engine-opnet
Version: ${VERSION}
Section: admin
Priority: optional
Architecture: all
Depends: blockhost-common (>= 0.1.0), nodejs (>= 22), python3 (>= 3.10)
Recommends: blockhost-provisioner-proxmox (>= 0.1.0) | blockhost-provisioner-libvirt (>= 0.1.0)
Maintainer: Blockhost <admin@blockhost.io>
Description: OPNet (Bitcoin L1) engine for Blockhost VM hosting
 Blockhost Engine provides the core subscription management system on OPNet:
 - WASM contract artifacts (BlockhostSubscriptions + AccessCredentialNFT)
 - Blockchain event monitor service (bundled JS, runs on Node.js)
 - Event handlers for VM provisioning and NFT minting
 - CLI tools: bw (wallet), ab (addressbook), is (identity), bhcrypt (crypto)
 - Installer wizard plugin for blockchain configuration
 .
 The monitor is a single bundled JavaScript file that runs on Node.js.
EOF

# Create DEBIAN/postinst
cat > "$PKG_DIR/DEBIAN/postinst" << 'EOF'
#!/bin/bash
set -e

case "$1" in
    configure)
        if [ -d /run/systemd/system ]; then
            systemctl daemon-reload || true
        fi

        echo ""
        echo "=========================================="
        echo "  blockhost-engine-opnet installed"
        echo "=========================================="
        echo ""
        echo "Next steps:"
        echo "1. Run the installer wizard, or manually:"
        echo "   blockhost-deploy-contracts both"
        echo "2. Update /etc/blockhost/web3-defaults.yaml with contract addresses"
        echo "3. sudo systemctl enable --now blockhost-monitor"
        echo ""
        ;;
esac
exit 0
EOF

# Create DEBIAN/prerm
cat > "$PKG_DIR/DEBIAN/prerm" << 'EOF'
#!/bin/bash
set -e
case "$1" in
    remove|upgrade|deconfigure)
        if [ -d /run/systemd/system ]; then
            systemctl stop blockhost-monitor 2>/dev/null || true
            systemctl disable blockhost-monitor 2>/dev/null || true
        fi
        ;;
esac
exit 0
EOF

# Create DEBIAN/postrm
cat > "$PKG_DIR/DEBIAN/postrm" << 'EOF'
#!/bin/bash
set -e
case "$1" in
    purge)
        rm -rf /opt/blockhost/node_modules 2>/dev/null || true
        ;;
esac
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true
fi
exit 0
EOF

chmod 755 "$PKG_DIR/DEBIAN/postinst" "$PKG_DIR/DEBIAN/prerm" "$PKG_DIR/DEBIAN/postrm"

# ============================================
# Copy application files
# ============================================
echo "Copying files..."

# Bin scripts
cp "$PROJECT_DIR/scripts/generate-signup-page" "$PKG_DIR/usr/bin/blockhost-generate-signup"
cp "$PROJECT_DIR/scripts/deploy-contracts" "$PKG_DIR/usr/bin/blockhost-deploy-contracts"
chmod 755 "$PKG_DIR/usr/bin/"*

# Create blockhost-mint-nft CLI wrapper (TypeScript, bundled via esbuild)
echo "Bundling mint_nft CLI with esbuild..."
npx esbuild "$PROJECT_DIR/scripts/mint_nft" \
    --bundle \
    --platform=node \
    --target=node22 \
    --minify \
    --loader:=ts \
    --outfile="$PKG_DIR/usr/share/blockhost/mint_nft.js"

if [ -f "$PKG_DIR/usr/share/blockhost/mint_nft.js" ]; then
    cat > "$PKG_DIR/usr/bin/blockhost-mint-nft" << 'MINTEOF'
#!/bin/sh
export NODE_OPTIONS="--dns-result-order=ipv4first${NODE_OPTIONS:+ $NODE_OPTIONS}"
exec /usr/bin/node /usr/share/blockhost/mint_nft.js "$@"
MINTEOF
    chmod 755 "$PKG_DIR/usr/bin/blockhost-mint-nft"
    MINT_SIZE=$(du -h "$PKG_DIR/usr/share/blockhost/mint_nft.js" | cut -f1)
    echo "mint_nft CLI bundle created: $MINT_SIZE"
else
    echo "WARNING: Failed to bundle mint_nft CLI"
fi

# Install engine wizard plugin (Python module + templates)
WIZARD_SRC="$PROJECT_DIR/blockhost/engine_opnet"
WIZARD_DST="$PKG_DIR/usr/lib/python3/dist-packages/blockhost/engine_opnet"
mkdir -p "$WIZARD_DST/templates/engine_opnet"
cp "$WIZARD_SRC/__init__.py" "$WIZARD_DST/"
cp "$WIZARD_SRC/wizard.py" "$WIZARD_DST/"
cp "$WIZARD_SRC/templates/engine_opnet/"*.html "$WIZARD_DST/templates/engine_opnet/"

# Install engine manifest
cp "$PROJECT_DIR/engine.json" "$PKG_DIR/usr/share/blockhost/engine.json"

# Static resources
cp "$PROJECT_DIR/scripts/signup-template.html" "$PKG_DIR/usr/share/blockhost/"

# Systemd service
cp "$PROJECT_DIR/examples/blockhost-monitor.service" "$PKG_DIR/lib/systemd/system/blockhost-monitor.service"

# ============================================
# Build package
# ============================================
echo ""
echo "Building package..."
dpkg-deb --build "$PKG_DIR"

echo ""
echo "=========================================="
echo "Package built: $SCRIPT_DIR/${PKG_NAME}.deb"
echo "=========================================="
dpkg-deb --info "$SCRIPT_DIR/${PKG_NAME}.deb"

# Show what's included
echo ""
echo "Package contents:"
echo "  /usr/share/blockhost/monitor.js    - Bundled monitor ($MONITOR_SIZE)"
echo "  /usr/share/blockhost/bw.js         - Bundled bw CLI ($BW_SIZE)"
echo "  /usr/share/blockhost/ab.js         - Bundled ab CLI ($AB_SIZE)"
echo "  /usr/share/blockhost/is.js         - Bundled is CLI ($IS_SIZE)"
echo "  /usr/share/blockhost/bhcrypt.js    - Bundled bhcrypt CLI ($BHCRYPT_SIZE)"
echo "  /usr/share/blockhost/mint_nft.js   - Bundled mint_nft CLI"
echo "  /usr/bin/bw                        - Blockwallet CLI wrapper"
echo "  /usr/bin/ab                        - Addressbook CLI wrapper"
echo "  /usr/bin/is                        - Identity predicate CLI wrapper"
echo "  /usr/bin/bhcrypt                   - Crypto tool CLI wrapper"
echo "  /usr/bin/blockhost-deploy-contracts - Contract deployer script"
echo "  /usr/bin/blockhost-mint-nft        - NFT minting CLI wrapper"
echo "  /usr/bin/blockhost-generate-signup  - Signup page generator"
echo "  /usr/lib/python3/dist-packages/blockhost/engine_opnet/ - Engine wizard plugin"
echo "  /usr/share/blockhost/engine.json   - Engine manifest"
echo "  /usr/share/blockhost/contracts/    - WASM + ABI contract artifacts"
echo "  /lib/systemd/system/               - Systemd service unit"

# Show contract artifacts status
echo ""
echo "Contract artifacts:"
for f in "$PKG_DIR/usr/share/blockhost/contracts/"*; do
    [ -f "$f" ] && echo "  $(basename "$f") ($(du -h "$f" | cut -f1))"
done

# Copy to packages/host/ if the parent project structure exists
# (for integration with blockhost-installer/scripts/build-packages.sh)
PACKAGES_HOST_DIR="$(dirname "$PROJECT_DIR")/blockhost-installer/packages/host"
if [ -d "$(dirname "$PACKAGES_HOST_DIR")" ]; then
    mkdir -p "$PACKAGES_HOST_DIR"
    cp "$SCRIPT_DIR/${PKG_NAME}.deb" "$PACKAGES_HOST_DIR/"
    echo ""
    echo "Copied to: $PACKAGES_HOST_DIR/${PKG_NAME}.deb"
fi

# ============================================
# Build template package: blockhost-auth-svc
# (installed on VMs, not the host)
# ============================================
echo ""
echo "=========================================="
echo "Building template package: blockhost-auth-svc v${VERSION}..."
echo "=========================================="

rm -rf "$TEMPLATE_PKG_DIR"
mkdir -p "$TEMPLATE_PKG_DIR"/{DEBIAN,usr/bin,usr/share/blockhost/signing-page,lib/systemd/system,usr/lib/tmpfiles.d}

# Copy bundled JS
cp "$SCRIPT_DIR/auth-svc.js" "$TEMPLATE_PKG_DIR/usr/share/blockhost/auth-svc.js"

# Create wrapper script
cat > "$TEMPLATE_PKG_DIR/usr/bin/web3-auth-svc" << 'AUTHEOF'
#!/bin/sh
exec /usr/bin/node /usr/share/blockhost/auth-svc.js "$@"
AUTHEOF
chmod 755 "$TEMPLATE_PKG_DIR/usr/bin/web3-auth-svc"

# Copy signing page HTML
cp "$PROJECT_DIR/auth-svc/signing-page/index.html" "$TEMPLATE_PKG_DIR/usr/share/blockhost/signing-page/index.html"

# Create systemd unit
cat > "$TEMPLATE_PKG_DIR/lib/systemd/system/web3-auth-svc.service" << 'SVCEOF'
[Unit]
Description=Web3 Authentication Signing Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/web3-auth-svc
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

# Create tmpfiles.d config (creates pending dir on boot)
cat > "$TEMPLATE_PKG_DIR/usr/lib/tmpfiles.d/web3-auth-svc.conf" << 'TMPEOF'
d /run/libpam-web3/pending 0755 root root -
TMPEOF

# Create DEBIAN/control
cat > "$TEMPLATE_PKG_DIR/DEBIAN/control" << EOF
Package: blockhost-auth-svc
Version: ${VERSION}
Section: admin
Priority: optional
Architecture: all
Depends: nodejs (>= 22)
Maintainer: Blockhost <admin@blockhost.io>
Description: Web3 authentication signing server for Blockhost VMs
 HTTPS server that serves the web3 signing page and handles
 callback-based signature submission for PAM authentication.
 .
 This package is installed on VM templates, not the Proxmox host.
 Requires Node.js >= 22 runtime.
EOF

# Create DEBIAN/postinst
cat > "$TEMPLATE_PKG_DIR/DEBIAN/postinst" << 'EOF'
#!/bin/bash
set -e
case "$1" in
    configure)
        # Create pending directory (also handled by tmpfiles.d on boot)
        mkdir -p /run/libpam-web3/pending
        chmod 0755 /run/libpam-web3/pending

        if [ -d /run/systemd/system ]; then
            systemctl daemon-reload || true
            systemd-tmpfiles --create web3-auth-svc.conf 2>/dev/null || true
        fi
        ;;
esac
exit 0
EOF

# Create DEBIAN/prerm
cat > "$TEMPLATE_PKG_DIR/DEBIAN/prerm" << 'EOF'
#!/bin/bash
set -e
case "$1" in
    remove|upgrade|deconfigure)
        if [ -d /run/systemd/system ]; then
            systemctl stop web3-auth-svc 2>/dev/null || true
            systemctl disable web3-auth-svc 2>/dev/null || true
        fi
        ;;
esac
exit 0
EOF

chmod 755 "$TEMPLATE_PKG_DIR/DEBIAN/postinst" "$TEMPLATE_PKG_DIR/DEBIAN/prerm"

# Build template .deb
dpkg-deb --build "$TEMPLATE_PKG_DIR"

echo ""
echo "=========================================="
echo "Template package built: $SCRIPT_DIR/${TEMPLATE_PKG_NAME}.deb"
echo "=========================================="
echo ""
echo "Template package contents:"
echo "  /usr/share/blockhost/auth-svc.js                  - Auth server bundle ($AUTH_SVC_SIZE)"
echo "  /usr/bin/web3-auth-svc                            - Auth server wrapper"
echo "  /usr/share/blockhost/signing-page/index.html      - Signing page HTML"
echo "  /lib/systemd/system/web3-auth-svc.service         - Systemd unit"
echo "  /usr/lib/tmpfiles.d/web3-auth-svc.conf            - tmpfiles.d config"
