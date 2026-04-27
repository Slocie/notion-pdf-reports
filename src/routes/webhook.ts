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

const notionWebhookSchema = z.object({
  verification_token: z.string().min(1).optional(),
  type: z.string().optional(),
  entity: z
    .object({
      id: z.string().min(1),
      type: z.string()
    })
    .optional(),
  page_id: z.string().min(1).optional(),
  pageId: z.string().min(1).optional()
});

export async function registerWebhookRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const notion = new NotionService(config);
  const pdf = new PdfService(config);

  app.post("/notion-webhook", { config: { rawBody: true } }, async (request, reply) => {
    const payload = notionWebhookSchema.parse(request.body);

    if (payload.verification_token) {
      request.log.info({ verificationToken: payload.verification_token }, "Notion webhook verification token received");
      return { status: "verification_received" };
    }

    verifyNotionSignature(request, config);

    const pageId =
      payload.entity?.type === "page" ? payload.entity.id : payload.page_id ?? payload.pageId;

    if (!pageId) {
      return reply.code(202).send({ status: "ignored", reason: "event_has_no_page_id" });
    }

    const report = await notion.buildReportFromPage(pageId);
    if (report.metadata.status !== config.triggerStatus) {
      return reply.code(202).send({
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
    const filename = `${safeFilename(report.metadata.title)}-${safeFilename(report.metadata.date)}.pdf`;
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
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "informe";
}
