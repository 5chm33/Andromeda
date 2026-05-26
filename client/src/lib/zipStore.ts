/**
 * Module-level store for raw ZIP bytes.
 * sessionStorage has a ~5MB limit which is too small for ZIP files.
 * This module persists across SPA navigation (React Router / wouter)
 * because module state survives component unmounts.
 */
let _rawBase64: string | undefined;
let _fileName: string | undefined;

export function setRawZip(fileName: string, rawBase64: string) {
  _rawBase64 = rawBase64;
  _fileName = fileName;
}

export function getRawZip(): { fileName: string; rawBase64: string } | undefined {
  if (_rawBase64 && _fileName) {
    return { fileName: _fileName, rawBase64: _rawBase64 };
  }
  return undefined;
}

export function clearRawZip() {
  _rawBase64 = undefined;
  _fileName = undefined;
}
