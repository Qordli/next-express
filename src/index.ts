import type { Request, Response, NextFunction } from "express";

export type RouteHandler<
  REQ extends Request = Request,
  RES extends Response = Response,
> = (req: REQ, res: RES) => void | Promise<void>;

export type Middleware<
  REQ extends Request = Request,
  RES extends Response = Response,
> = (req: REQ, res: RES, next: NextFunction) => void | Promise<void>;

export type ErrorMiddleware<
  REQ extends Request = Request,
  RES extends Response = Response,
> = (
  err: Error,
  req: REQ,
  res: RES,
  next: NextFunction,
) => void | Promise<void>;
