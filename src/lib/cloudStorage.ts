/**
 * Cloud storage client for uploading files to R2 via the gateway.
 * All generated files are uploaded locally first, then pushed to R2
 * for sharing via public URLs.
 */
import {GATEWAY_URL} from '../config';
import {fetchWithTimeout} from './fetchWithTimeout';
import * as RNFS from '@dr.pogodin/react-native-fs';

export interface UploadResult {
  url: string;
  hash: string;
  size: number;
}

export class CloudStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudStorageError';
  }
}

/**
 * Convert a base64 string to a Uint8Array.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  // React Native may not have atob, so we use a simple decode
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/=+$/, '');
  let output = '';
  for (let i = 0; i < str.length; i += 4) {
    const a = chars.indexOf(str[i]) || 0;
    const b = chars.indexOf(str[i + 1]) || 0;
    const c = chars.indexOf(str[i + 2]) || 0;
    const d = chars.indexOf(str[i + 3]) || 0;
    output += String.fromCharCode((a << 2) | (b >> 4));
    if (str[i + 2] !== '=') output += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    if (str[i + 3] !== '=') output += String.fromCharCode(((c & 3) << 6) | d);
  }
  const bytes = new Uint8Array(output.length);
  for (let i = 0; i < output.length; i++) {
    bytes[i] = output.charCodeAt(i);
  }
  return bytes;
}

/**
 * Upload a local file to R2 via the gateway.
 */
export async function uploadFile(
  localPath: string,
  apiKey: string,
  filename?: string,
): Promise<UploadResult> {
  const fileExists = await RNFS.exists(localPath);
  if (!fileExists) {
    throw new CloudStorageError(`File not found: ${localPath}`);
  }

  const stat = await RNFS.stat(localPath);
  const fileSize = typeof stat.size === 'string' ? parseInt(stat.size, 10) : stat.size;
  if (fileSize > 50 * 1024 * 1024) {
    throw new CloudStorageError('File exceeds 50MB limit');
  }

  const base64 = await RNFS.readFile(localPath, 'base64');
  const bytes = base64ToUint8Array(base64);
  const name = filename || localPath.split('/').pop() || 'file';

  const res = await fetchWithTimeout(
    `${GATEWAY_URL}/v1/uploads/file`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Filename': name,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes as any,
    },
    30000,
  );

  const body = await res.json();
  if (!body.success) {
    throw new CloudStorageError(body.error || 'Upload failed');
  }

  return {url: body.url, hash: body.hash, size: body.size};
}

/**
 * Upload raw content (string/bytes) directly to R2.
 */
export async function uploadContent(
  content: string | Uint8Array,
  apiKey: string,
  filename: string,
  contentType: string,
): Promise<UploadResult> {
  let bytes: Uint8Array;
  if (typeof content === 'string') {
    // Convert string to Uint8Array manually
    bytes = new Uint8Array(content.length);
    for (let i = 0; i < content.length; i++) {
      bytes[i] = content.charCodeAt(i) & 0xff;
    }
  } else {
    bytes = content;
  }

  if (bytes.length > 50 * 1024 * 1024) {
    throw new CloudStorageError('Content exceeds 50MB limit');
  }

  const res = await fetchWithTimeout(
    `${GATEWAY_URL}/v1/uploads/file`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Filename': filename,
        'Content-Type': contentType,
      },
      body: bytes as any,
    },
    30000,
  );

  const body = await res.json();
  if (!body.success) {
    throw new CloudStorageError(body.error || 'Upload failed');
  }

  return {url: body.url, hash: body.hash, size: body.size};
}

/**
 * Upload a base64-encoded file to R2.
 */
export async function uploadBase64(
  base64Content: string,
  apiKey: string,
  filename: string,
  contentType: string,
): Promise<UploadResult> {
  const bytes = base64ToUint8Array(base64Content);

  const res = await fetchWithTimeout(
    `${GATEWAY_URL}/v1/uploads/file`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Filename': filename,
        'Content-Type': contentType,
      },
      body: bytes as any,
    },
    30000,
  );

  const body = await res.json();
  if (!body.success) {
    throw new CloudStorageError(body.error || 'Upload failed');
  }

  return {url: body.url, hash: body.hash, size: body.size};
}
