import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { NotionService } from "../services/notion.service.js";
import { PdfService } from "../services/pdf.service.js";
import type { GeneratePdfResult } from "../../types/index.js";

const generatePdfSchema = z.object({
  page_id: z.string().min(1).optional(),
  pageId: z.string().min(1).optional()
});

export async function registerWebhookRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const notion = new NotionService(config);
  const pdf = new PdfService(config);

  app.post("/notion-webhook", { config: { rawBody: true } }, async (request, reply) => {
    const payload = asRecord(request.body);

    if (config.webhookDebugLogBody) {
      request.log.info(
        {
          headers: {
            "content-type": request.headers["content-type"],
            "user-agent": request.headers["user-agent"],
            "x-notion-signature": request.headers["x-notion-signature"]
          },
          bodyKeys: Object.keys(payload),
          pageId: extractPageId(payload)
        },
        "Notion webhook debug payload"
      );
    }

    if (typeof payload.verification_token === "string" && payload.verification_token) {
      request.log.info({ verificationToken: payload.verification_token }, "Notion webhook verification token received");
      return { status: "verification_received" };
    }

    verifyNotionSignature(request, config);

    const pageId = extractPageId(payload);

    if (!pageId) {
      request.log.warn({ bodyKeys: Object.keys(payload) }, "Notion webhook ignored because no page id was found");
      return reply.code(200).send({ status: "ignored", reason: "event_has_no_page_id" });
    }

    const report = await notion.buildReportFromPage(pageId);
    if (report.metadata.status !== config.triggerStatus) {
      return reply.code(200).send({
        status: "ignored",
        reason: "trigger_status_not_set",
        pageId,
        currentStatus: report.metadata.status,
        expectedStatus: config.triggerStatus
      });
    }

    return generatePdf({ pageId, notion, pdf, config, request, reply });
  });

  app.post("/generate-pdf", async (request, reply) => {
    verifyN8nToken(request, config);

    const payload = generatePdfSchema.parse(request.body);
    const pageId = payload.page_id ?? payload.pageId;
    if (!pageId) {
      return reply.code(400).send({ error: "missing_page_id" });
    }

    return generatePdf({ pageId, notion, pdf, config, request, reply });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function extractPageId(payload: Record<string, unknown>): string {
  const entity = asRecord(payload.entity);
  if (entity.type === "page" && typeof entity.id === "string") return entity.id;

  const data = asRecord(payload.data);
  if (data.object === "page" && typeof data.id === "string") return data.id;

  const direct = firstString(
    payload.page_id,
    payload.pageId,
    payload.id,
    payload["Page ID"],
    payload["Page id"],
    payload["page id"],
    payload["Página ID"],
    payload["Pagina ID"]
  );
  if (direct) return normalizePageId(direct);

  const found = findPageIdDeep(payload);
  return found ? normalizePageId(found) : "";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringFromUnknown(value);
    if (text) return text;
  }
  return "";
}

function findPageIdDeep(value: unknown, depth = 0): string {
  if (depth > 5) return "";

  const text = stringFromUnknown(value);
  const match = text.match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i);
  if (match) return match[0];

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPageIdDeep(item, depth + 1);
      if (found) return found;
    }
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = findPageIdDeep(item, depth + 1);
      if (found) return found;
    }
  }

  return "";
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstString(record.id, record.pageId, record.page_id, record.url, record.plain_text, record.content);
  }

  return "";
}

function normalizePageId(value: string): string {
  return value.trim().replaceAll("-", "");
}

async function generatePdf(input: {
  pageId: string;
  notion: NotionService;
  pdf: PdfService;
  config: AppConfig;
  request: FastifyRequest;
  reply: FastifyReply;
}): Promise<GeneratePdfResult | unknown> {
  const { pageId, notion, pdf, config, request, reply } = input;

  try {
    const report = await notion.buildReportFromPage(pageId);
    const indexHtml = await pdf.renderHtml(report.content.html);
    const pdfBuffer = await pdf.htmlToPdf(indexHtml);
    const filename = buildPdfFilename(report.metadata.title, report.metadata.date);
    const fileUploadId = await notion.uploadPdfAndAttach(pageId, filename, pdfBuffer);
    await notion.markStatus(pageId, config.successStatus);

    return {
      status: "ok",
      pageId,
      filename,
      fileUploadId,
      pdfBytes: pdfBuffer.length
    };
  } catch (error) {
    await notion.markStatus(pageId, config.errorStatus).catch(() => undefined);
    request.log.error({ error }, "PDF generation failed");
    return reply.code(502).send({
      error: "pdf_generation_failed",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

function verifyN8nToken(request: FastifyRequest, config: AppConfig): void {
  const authorization = request.headers.authorization;
  const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const headerToken = request.headers["x-api-secret-token"];
  const token = bearerToken || (Array.isArray(headerToken) ? headerToken[0] : headerToken);

  if (token !== config.apiSecretToken) {
    throw Object.assign(new Error("Invalid API secret token."), { statusCode: 401 });
  }
}

function verifyNotionSignature(request: FastifyRequest, config: AppConfig): void {
  if (!config.notionWebhookVerificationToken) return;

  const signatureHeader = request.headers["x-notion-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const rawBody = typeof request.rawBody === "string" ? request.rawBody : JSON.stringify(request.body ?? {});

  if (!signature) {
    throw Object.assign(new Error("Missing Notion signature."), { statusCode: 401 });
  }

  const expected = `sha256=${createHmac("sha256", config.notionWebhookVerificationToken).update(rawBody).digest("hex")}`;
  const trusted =
    Buffer.byteLength(signature) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!trusted) {
    throw Object.assign(new Error("Invalid Notion signature."), { statusCode: 401 });
  }
}

function safeFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "informe";
}

function buildPdfFilename(title: string, date: string): string {
  const safeTitle = safeFilename(title);
  const safeDate = safeFilename(date);
  const suffix = `-${safeDate}.pdf`;
  const maxTitleLength = Math.max(1, 100 - suffix.length);

  return `${safeTitle.slice(0, maxTitleLength).replace(/-+$/g, "")}${suffix}`;
}
