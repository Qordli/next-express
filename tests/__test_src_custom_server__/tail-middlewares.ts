export function notFound(req, res) {
  res.status(404).send("Not Found");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err, req, res, next) {
  console.error(err);
  res.status(500).send("Internal Server Error");
}

export const middlewares = [notFound, errorMiddleware];
