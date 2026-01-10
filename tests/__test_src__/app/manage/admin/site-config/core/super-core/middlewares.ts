import { Handler } from "express";

const authMiddleware: Handler = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).send("Unauthorized");
    return;
  }
  next();
};

export const middlewares = [authMiddleware];
