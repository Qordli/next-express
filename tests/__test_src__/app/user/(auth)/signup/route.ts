import { Request, Response } from "express";

export function POST(req: Request, res: Response) {
  res.send("Hello from POST /user/(auth)/signup");
}
