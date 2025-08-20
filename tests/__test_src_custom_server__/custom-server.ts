import express from "express";
import { Server as SioServer } from "socket.io";
import { createServer as CreateHttpServer } from "http";
/* __nextExpress_imports__ */

export const createServer = () => {
  const app = express();

  /* __nextExpress_settings__ */

  const server = CreateHttpServer(app);
  const io = new SioServer(server);
  io.on("connection", (socket) => {
    console.log("New socket connection:", socket.id);
  });

  /* __nextExpress_topLevelMiddlewares__ */

  /* __nextExpress_routes__ */

  /* __nextExpress_tailMiddlewares__ */
  return app;
};
