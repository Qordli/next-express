import { RouteHandler } from "next-express/type-utils";

export const GET: RouteHandler = async (req, res) => {
  res.send("Hello from GET /user/(home)/avatar");
};
