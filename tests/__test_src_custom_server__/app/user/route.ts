import { RouteHandler } from "next-express/type-utils";

export const GET: RouteHandler = async (req, res) => {
  // Handle GET request
  res.send("Hello from GET in /user");
};
