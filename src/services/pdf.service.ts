import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { AppConfig } from "../config.js";

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = join(here, "..", "templates");

export class PdfService {
  constructor(private readonly config: AppConfig) {}

  async renderHtml(reportHtml: string): Promise<string> {
    const shell = await readFile(join(templateDir, "report.html"), "utf8");
    return shell
      .replaceAll("{{COMPANY_LOGO_URL}}", escapeHtml(this.config.companyLogoUrl))
      .replaceAll("{{COMPANY_NAME}}", escapeHtml(this.config.companyName))
      .replaceAll("{{CLINICIAN_NAME}}", escapeHtml(this.config.clinicianName))
      .replace("{{REPORT_BODY}}", reportHtml);
  }

  async htmlToPdf(indexHtml: string): Promise<Buffer> {
    const styleCss = await readFile(join(templateDir, "style.css"), "utf8");
    const form = new FormData();
    form.append("files", new Blob([indexHtml], { type: "text/html; charset=utf-8" }), "index.html");
    form.append("files", new Blob([styleCss], { type: "text/css; charset=utf-8" }), "style.css");
    form.append("printBackground", "true");
    form.append("preferCssPageSize", "true");

    const headers = new Headers();
    if (this.config.gotenbergUsername && this.config.gotenbergPassword) {
      headers.set(
        "Authorization",
        `Basic ${Buffer.from(`${this.config.gotenbergUsername}:${this.config.gotenbergPassword}`).toString("base64")}`
      );
    }

    const response = await fetch(`${this.config.gotenbergEndpoint}/forms/chromium/convert/html`, {
      method: "POST",
      headers,
      body: form
    });

    if (!response.ok) {
      throw new Error(`Gotenberg HTTP ${response.status}: ${await response.text()}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
