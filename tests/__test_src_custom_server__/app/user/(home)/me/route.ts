import { RouteHandler } from "@qordli/next-express";

export const GET: RouteHandler = async (req, res) => {
  res.send("Hello from GET /user/(home)/me");
};
