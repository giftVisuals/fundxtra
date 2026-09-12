import type { Response } from 'express';
import type { ApiResponse } from '@fundxtra/shared';

/** Single success envelope, so every route returns the same shape. */
export function ok<T>(res: Response, data: T, status = 200): void {
  const body: ApiResponse<T> = { ok: true, data };
  res.status(status).json(body);
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, 201);
}

export function noContent(res: Response): void {
  res.status(204).end();
}
