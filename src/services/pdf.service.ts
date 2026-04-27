import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { AppConfig } from "../config.js";

const here = dirname(fileURLToPath(import.meta.url));
const templateDirs = [join(here, "..", "templates"), join(here, "..", "..", "..", "src", "templates")];
const assetDirs = [join(here, "..", "..", "assets"), join(here, "..", "..", "..", "assets")];

export class PdfService {
  constructor(private readonly config: AppConfig) {}

  async renderHtml(reportHtml: string): Promise<string> {
    const shell = await readTemplate("report.html");
    const signatureSrc = this.config.signatureImageUrl || "signature.png";
    const signatureHtml = this.renderSignatureHtml(signatureSrc);
    const reportWithSignature = injectSignatureNearLabel(reportHtml, signatureHtml);

    return shell
      .replace("{{SIGNATURE_BLOCK}}", reportWithSignature === reportHtml ? signatureHtml : "")
      .replace("{{REPORT_BODY}}", reportWithSignature);
  }

  async htmlToPdf(indexHtml: string): Promise<Buffer> {
    const styleCss = await readTemplate("style.css");
    const headerHtml = await this.renderHeaderHtml();
    const form = new FormData();
    form.append("files", new Blob([indexHtml], { type: "text/html; charset=utf-8" }), "index.html");
    form.append("files", new Blob([styleCss], { type: "text/css; charset=utf-8" }), "style.css");
    form.append("files", new Blob([headerHtml], { type: "text/html; charset=utf-8" }), "header.html");
    await this.appendAssetIfAvailable(form, "logo.png", "image/png");
    await this.appendAssetIfAvailable(form, "signature.png", "image/png");
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

  private async appendAssetIfAvailable(form: FormData, filename: string, contentType: string): Promise<void> {
    for (const dir of assetDirs) {
      try {
        const file = await readFile(join(dir, filename));
        form.append("files", new Blob([file], { type: contentType }), filename);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  private async renderHeaderHtml(): Promise<string> {
    const logoSrc = this.config.companyLogoUrl || (await assetDataUri("logo.png", "image/png")) || "logo.png";

    return `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: "Aptos", "Segoe UI", Arial, sans-serif;
              margin: 0;
              padding: 0 18mm;
            }
            .header {
              align-items: center;
              border-bottom: 2px solid #e8def1;
              display: flex;
              height: 17mm;
              justify-content: space-between;
              padding-bottom: 3mm;
              width: 100%;
            }
            img {
              display: block;
              max-height: 13mm;
              max-width: 54mm;
              object-fit: contain;
            }
            .contact {
              color: #163b47;
              font-size: 8.5pt;
              font-weight: 600;
              line-height: 1.35;
              text-align: right;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <img src="${escapeHtml(logoSrc)}" alt="">
            <div class="contact">
              <div>${escapeHtml(this.config.headerWebsite)}</div>
              <div>${escapeHtml(this.config.headerEmail)}</div>
            </div>
          </div>
        </body>
      </html>`;
  }

  private renderSignatureHtml(signatureSrc: string): string {
    return `
      <span class="signature-inline-image">
        <img src="${escapeHtml(signatureSrc)}" alt="">
      </span>
    `;
  }
}

function injectSignatureNearLabel(reportHtml: string, signatureHtml: string): string {
  const labelPattern =
    /<p>(?:(?:<strong>)?\s*)?(Unterschrift|Firma|Signature)(?::)?(?:(?:\s*<\/strong>)?)\s*<\/p>(?![\s\S]*<p>(?:(?:<strong>)?\s*)?(?:Unterschrift|Firma|Signature)(?::)?(?:(?:\s*<\/strong>)?)\s*<\/p>)/i;

  return reportHtml.replace(labelPattern, (match) => {
    const label = match.replace(/^<p>|<\/p>$/g, "");
    return `
      <section class="signature-line">
        <div class="signature-label">${label}</div>
        ${signatureHtml}
      </section>
    `;
  });
}

async function assetDataUri(filename: string, contentType: string): Promise<string> {
  for (const dir of assetDirs) {
    try {
      const file = await readFile(join(dir, filename));
      return `data:${contentType};base64,${file.toString("base64")}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  return "";
}

async function readTemplate(filename: string): Promise<string> {
  let lastError: unknown;

  for (const dir of templateDirs) {
    try {
      return await readFile(join(dir, filename), "utf8");
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw lastError;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
