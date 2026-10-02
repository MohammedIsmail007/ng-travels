import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: any = express();

// This API serves dynamic, frequently-polled JSON — disable Express's default
// weak ETag generation so responses aren't treated as cacheable and clients
// don't get 304s for data that's meant to be re-fetched every time.
app.set("etag", false);

// Vercel's Node.js runtime stamps every function response with
// "Cache-Control: public, max-age=0, must-revalidate" by default unless the
// app sets its own — "public" tells any intermediate cache (CDN, proxy, and
// notably a native mobile HTTP stack like Android's OkHttp, which the
// Capacitor app's CapacitorHttp plugin routes through) that this
// authorization-gated, per-user response is safe to store and reuse across
// different callers. It isn't: two requests to the same URL with different
// Authorization headers can get completely different data. Force no-store
// on every API response so nothing between the app and this server ever
// caches or replays one user's data for another, or replays a stale
// response after a fresh login.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const httpLogger = typeof pinoHttp === "function" ? pinoHttp : (pinoHttp as any).default || pinoHttp;

app.use(
  httpLogger({
    logger,
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
// Trip saves carry route data (stops, route options); Express's default
// 100kb limit rejected long routes with a non-JSON 413 response.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/api", router);
app.use(router);

export default app;
