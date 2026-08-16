import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { ApiResponse } from '@today-todo/contracts';

import type { ApiService } from './api-service.js';
import type { HttpRequest } from './types.js';

const MAX_BODY_BYTES = 1024 * 1024;

class PayloadTooLargeError extends Error {}

export interface HttpServerOptions {
  readonly api: ApiService;
  readonly port: number;
  readonly logger?: (message: string) => void;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  const body: ApiResponse<never> = {
    success: false,
    data: null,
    error: { code, message },
    meta: {}
  };
  sendJson(res, status, body);
}

function readBody(request: IncomingMessage, limitBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new PayloadTooLargeError());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

export function startServer(options: HttpServerOptions): Server {
  const server = createServer((req, res) => {
    void handleRequest(req, res, options);
  });

  server.listen(options.port, '127.0.0.1', () => {
    options.logger?.(`[http] listening on http://127.0.0.1:${String(options.port)}`);
  });
  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: HttpServerOptions
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    const method = req.method;
    if (method !== 'GET' && method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') {
      sendError(res, 405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
      return;
    }

    const bodyText = await readBody(req, MAX_BODY_BYTES);
    let body: unknown;
    if (bodyText.length > 0) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        sendError(res, 400, 'INPUT_INVALID', '请求体不是合法 JSON');
        return;
      }
    }

    const request: HttpRequest = {
      method,
      path: url.pathname,
      ...(url.searchParams.size > 0 ? { query: Object.fromEntries(url.searchParams) } : {}),
      ...(typeof req.headers['x-session-token'] === 'string'
        ? { token: req.headers['x-session-token'] }
        : {}),
      ...(typeof req.headers['x-request-id'] === 'string'
        ? { requestId: req.headers['x-request-id'] }
        : {}),
      ...(body === undefined ? {} : { body }),
      ...(req.headers['x-http-method-override'] === 'PATCH' ? { methodOverride: 'PATCH' } : {})
    };

    const result = await options.api.handle(request);
    sendJson(res, result.status, result.body);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', '请求体过大');
      return;
    }
    options.logger?.(
      `[http] request failed: ${error instanceof Error ? error.message : String(error)}`
    );
    sendError(res, 500, 'INTERNAL_ERROR', '服务暂时不可用，请稍后重试');
  }
}
