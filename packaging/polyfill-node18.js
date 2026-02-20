/**
 * Node.js 18 polyfills for APIs added in Node.js 20.
 * undici (bundled via opnet) uses these at module init time.
 * Injected via esbuild --banner into all bundles that import opnet.
 */

// globalThis.File — used by undici's webidl type assertions
if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File extends Blob {
    constructor(bits, name, options = {}) {
      super(bits, options);
      this.name = name;
      this.lastModified = options.lastModified || Date.now();
    }
  };
}

// String.prototype.isWellFormed — used by undici's USVString check
if (!String.prototype.isWellFormed) {
  String.prototype.isWellFormed = function () {
    for (let i = 0; i < this.length; i++) {
      const c = this.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = this.charCodeAt(i + 1);
        if (next < 0xdc00 || next > 0xdfff) return false;
        i++;
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        return false;
      }
    }
    return true;
  };
}

// String.prototype.toWellFormed — used by undici's USVString converter
if (!String.prototype.toWellFormed) {
  String.prototype.toWellFormed = function () {
    let result = '';
    for (let i = 0; i < this.length; i++) {
      const c = this.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = this.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          result += this[i] + this[i + 1];
          i++;
        } else {
          result += '\ufffd';
        }
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        result += '\ufffd';
      } else {
        result += this[i];
      }
    }
    return result;
  };
}
