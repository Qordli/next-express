import { RouteHandler } from "@qordli/next-express";

export const GET: RouteHandler = async (req, res) => {
  // Handle GET request
  res.send("Hello from GET in /manage/admin/whitelist");
};
