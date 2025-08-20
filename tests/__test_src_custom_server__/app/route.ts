import { Request, Response } from "express";

export function GET(req: Request, res: Response) {
  res.send("Hello from GET");
}

export const POST = async (req: Request, res: Response) => {
  res.send("Hello from POST");
};
