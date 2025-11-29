import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';

const isProd = process.env.NODE_ENV === "production";

export const loggerOptions: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? "info",
    genReqId: (req, res) => {
      const id = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
    customSuccessMessage: (req, res, responseTime) => `${req.method} ${req.url} ${res.statusCode} ${responseTime}ms`,
    transport: isProd ? undefined : {
      target: "pino-pretty",
      options: { singleLine: true, ignore: "pid,hostname,req,res,responseTime" },
    },
  },
};
