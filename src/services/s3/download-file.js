import { GetObjectCommand } from '@aws-sdk/client-s3'

import { config } from '../../config.js'
import { createS3Client } from './s3-client.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import {
  logPerf,
  perfNow,
  heapUsedMb
} from '../../common/helpers/perf-evidence.js'

const logger = createLogger()

/** Default download timeout in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Maximum file size in bytes that will be downloaded. Shares the configured
 * upload limit (UPLOAD_MAX_FILE_SIZE_BYTES, default 100 MB) so this backstop
 * stays in step with the limit sent to the CDP Uploader.
 */
const MAX_FILE_SIZE_BYTES = config.get('upload.maxFileSizeBytes')

/**
 * Download a file from S3 and return its contents as a Buffer.
 *
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Buffer>}
 * @throws {S3FileTooLargeError} When the object exceeds MAX_DOWNLOAD_BYTES
 * @throws {S3TimeoutError} When the download exceeds the timeout
 * @throws {S3ConnectionError} When S3 cannot be reached or returns an error
 */
async function downloadFile(
  bucket,
  key,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const client = createS3Client()
  logger.info(
    `Downloading S3 object - bucket: ${bucket}, key: ${key}, timeoutMs: ${timeoutMs}`
  )

  const signal = AbortSignal.timeout(timeoutMs)

  let response
  try {
    response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: signal }
    )
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      logger.warn(
        `S3 download timed out after ${timeoutMs}ms - bucket: ${bucket}, key: ${key}`
      )
      throw new S3TimeoutError(
        `S3 download timed out after ${timeoutMs}ms (bucket: ${bucket}, key: ${key})`
      )
    }
    logger.error(
      `S3 download failed - bucket: ${bucket}, key: ${key}, error: ${err.message}`
    )
    throw new S3ConnectionError(
      `S3 download failed for bucket: ${bucket}, key: ${key}: ${err.message}`
    )
  }

  const contentLength = Number(response.ContentLength)
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE_BYTES) {
    logger.warn(
      `S3 object exceeds size limit - bucket: ${bucket}, key: ${key}, contentLength: ${contentLength}, maxBytes: ${MAX_FILE_SIZE_BYTES}`
    )
    throw new S3FileTooLargeError(
      `S3 object size ${contentLength} exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes (bucket: ${bucket}, key: ${key})`
    )
  }

  const bufferStart = perfNow()
  const heapBeforeMb = heapUsedMb()
  try {
    const chunks = []
    for await (const chunk of response.Body) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)
    // Evidence (Item 4 — whole file buffered into memory, up to 100 MB): the S3
    // object is accumulated into a single Buffer held for the request lifecycle
    // (later coexisting with the temp-file copy and parsed GeoJSON arrays).
    // heapDeltaMb shows how much resident memory one download adds; a few
    // concurrent large uploads multiply this against a single-process instance.
    const heapAfterMb = heapUsedMb()
    logPerf(logger, 'file-buffered-memory', {
      bytes: buffer.byteLength,
      heapBeforeMb,
      heapAfterMb,
      heapDeltaMb: heapAfterMb - heapBeforeMb,
      bufferMs: Math.round(perfNow() - bufferStart)
    })
    logger.info(
      `Downloaded S3 object - bucket: ${bucket}, key: ${key}, size: ${buffer.byteLength} bytes`
    )
    return buffer
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      logger.warn(
        `S3 stream timed out after ${timeoutMs}ms - bucket: ${bucket}, key: ${key}`
      )
      throw new S3TimeoutError(
        `S3 stream timed out after ${timeoutMs}ms (bucket: ${bucket}, key: ${key})`
      )
    }
    logger.error(
      `S3 stream error - bucket: ${bucket}, key: ${key}, error: ${err.message}`
    )
    throw new S3ConnectionError(
      `S3 stream error for bucket: ${bucket}, key: ${key}: ${err.message}`
    )
  }
}

class S3FileTooLargeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'S3FileTooLargeError'
  }
}

class S3TimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'S3TimeoutError'
  }
}

class S3ConnectionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'S3ConnectionError'
  }
}

export {
  downloadFile,
  S3FileTooLargeError,
  S3TimeoutError,
  S3ConnectionError,
  DEFAULT_TIMEOUT_MS,
  MAX_FILE_SIZE_BYTES
}
