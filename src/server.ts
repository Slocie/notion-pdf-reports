import cors from "@fastify/cors";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { ZodError } from "zod";

import { loadConfig, validateRuntimeConfig } from "./config.js";
import { registerWebhookRoutes } from "./routes/webhook.js";

const config = loadConfig();
validateRuntimeConfig(config);

const app = Fastify({
  logger: true,
  bodyLimit: 2 * 1024 * 1024
});

await app.register(cors, { origin: false });
await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true
});

app.get("/health", async () => ({
  status: "ok",
  service: "notion-patient-pdf-automator",
  gotenbergEndpoint: config.gotenbergEndpoint
}));

await registerWebhookRoutes(app, config);

app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "invalid_payload",
      details: error.flatten()
    });
  }

  const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
  return reply.code(statusCode).send({
    error: statusCode === 401 ? "unauthorized" : "internal_error",
    message: error.message
  });
});

await app.listen({ host: config.host, port: config.port });
