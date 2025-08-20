import express from "express";
import cors from "cors";

const errorMiddleware = (
  err: Error,
  req: express.Request,
  res: express.Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: express.NextFunction,
) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
};

export const middlewares = [
  express.json({ limit: "50mb" }),
  express.urlencoded({ extended: true, limit: "50mb" }),
  cors(),
  errorMiddleware,
];
