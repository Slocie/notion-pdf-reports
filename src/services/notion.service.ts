import { Client } from "@notionhq/client";
import type {
  BlockObjectResponse,
  PageObjectResponse,
  PartialBlockObjectResponse,
  PartialPageObjectResponse
} from "@notionhq/client/build/src/api-endpoints.js";

import type { AppConfig } from "../config.js";
import type { MedicalReport } from "../../types/index.js";

type AnyProperty = Record<string, unknown>;

export class NotionService {
  private readonly notion: Client;

  constructor(private readonly config: AppConfig) {
    this.notion = new Client({
      auth: config.notionApiKey,
      notionVersion: config.notionVersion
    });
  }

  async buildReportFromPage(pageId: string): Promise<MedicalReport> {
    const page = await this.getPage(pageId);
    const properties = page.properties as Record<string, AnyProperty>;
    const blocks = await this.getAllBlockChildren(pageId);

    const title =
      this.firstNonEmptyProperty(properties, ["Informe", "Nombre", "Title", "Name"]) || "Informe medico";
    const patient =
      this.firstNonEmptyProperty(properties, ["Paciente", "Patient", "Nombre del paciente"]) || "Sin paciente";
    const date = this.firstNonEmptyProperty(properties, ["Fecha", "Date"]) || new Date().toISOString().slice(0, 10);
    const status = this.propertyText(properties[this.config.statusProperty]);

    return {
      sourcePageId: pageId,
      metadata: {
        title,
        date,
        status,
        patient: { name: patient }
      },
      content: {
        html: this.renderReportHtml({ title, patient, date, status, blocks })
      }
    };
  }

  async uploadPdfAndAttach(pageId: string, filename: string, pdf: Buffer): Promise<string> {
    const upload = await this.createFileUpload(filename, pdf.length);
    await this.sendFileUpload(upload.uploadUrl, filename, pdf);
    await this.attachPdfToPage(pageId, filename, upload.id);
    return upload.id;
  }

  async markStatus(pageId: string, value: string): Promise<void> {
    if (!this.config.statusProperty || !value) return;

    const page = await this.getPage(pageId);
    const property = (page.properties as Record<string, AnyProperty>)[this.config.statusProperty];
    const type = typeof property?.type === "string" ? property.type : "";

    if (type !== "status" && type !== "select") return;

    await this.notion.pages.update({
      page_id: pageId,
      properties: {
        [this.config.statusProperty]: {
          [type]: { name: value }
        }
      } as never
    });
  }

  private async getPage(pageId: string): Promise<PageObjectResponse> {
    const page = await this.notion.pages.retrieve({ page_id: pageId });
    if (!("properties" in page)) {
      throw new Error(`Notion page ${pageId} is not accessible as a full page object.`);
    }
    return page;
  }

  private async getAllBlockChildren(blockId: string): Promise<Array<BlockObjectResponse | PartialBlockObjectResponse>> {
    const blocks: Array<BlockObjectResponse | PartialBlockObjectResponse> = [];
    let startCursor: string | undefined;

    do {
      const response = await this.notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: startCursor
      });
      blocks.push(...response.results);
      startCursor = response.next_cursor ?? undefined;
    } while (startCursor);

    return blocks;
  }

  private async createFileUpload(filename: string, contentLength: number): Promise<{ id: string; uploadUrl: string }> {
    const response = await this.notionFetch("https://api.notion.com/v1/file_uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "single_part",
        filename,
        content_type: "application/pdf",
        content_length: contentLength
      })
    });
    const data = (await response.json()) as { id?: string; upload_url?: string };
    if (!data.id || !data.upload_url) {
      throw new Error("Notion did not return a valid file upload object.");
    }
    return { id: data.id, uploadUrl: data.upload_url };
  }

  private async sendFileUpload(uploadUrl: string, filename: string, pdf: Buffer): Promise<void> {
    const form = new FormData();
    const bytes = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);

    await this.notionFetch(uploadUrl, {
      method: "POST",
      body: form
    });
  }

  private async attachPdfToPage(pageId: string, filename: string, uploadId: string): Promise<void> {
    if (this.config.pdfProperty) {
      await this.notion.pages.update({
        page_id: pageId,
        properties: {
          [this.config.pdfProperty]: {
            files: [
              {
                name: filename,
                type: "file_upload",
                file_upload: { id: uploadId }
              }
            ]
          }
        } as never
      });
      return;
    }

    await this.notion.blocks.children.append({
      block_id: pageId,
      children: [
        {
          object: "block",
          type: "file",
          file: {
            type: "file_upload",
            file_upload: { id: uploadId },
            caption: [{ type: "text", text: { content: filename } }]
          }
        }
      ] as never
    });
  }

  private async notionFetch(url: string, init: RequestInit): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.notionApiKey}`,
        "Notion-Version": this.config.notionVersion,
        Accept: "application/json",
        ...init.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Notion HTTP ${response.status}: ${await response.text()}`);
    }
    return response;
  }

  private renderReportHtml(input: {
    title: string;
    patient: string;
    date: string;
    status: string;
    blocks: Array<BlockObjectResponse | PartialBlockObjectResponse | PartialPageObjectResponse>;
  }): string {
    const blocksHtml = input.blocks.map((block) => this.blockToHtml(block)).join("\n");

    return `
      <h1>${escapeHtml(input.title)}</h1>
      <section class="meta">
        <div class="label">Paciente</div><div>${escapeHtml(input.patient)}</div>
        <div class="label">Fecha</div><div>${escapeHtml(input.date)}</div>
        <div class="label">Estado</div><div>${escapeHtml(input.status)}</div>
      </section>
      <article>${blocksHtml || "<p>Sin contenido clinico en la pagina de Notion.</p>"}</article>
    `;
  }

  private blockToHtml(block: BlockObjectResponse | PartialBlockObjectResponse | PartialPageObjectResponse): string {
    if (!("type" in block)) return "";

    const value = block[block.type as keyof typeof block] as Record<string, unknown> | undefined;
    const richText = Array.isArray(value?.rich_text) ? richTextToHtml(value.rich_text as RichTextItem[]) : "";

    switch (block.type) {
      case "paragraph":
        return richText ? `<p>${richText}</p>` : "";
      case "heading_1":
        return `<h2>${richText}</h2>`;
      case "heading_2":
        return `<h3>${richText}</h3>`;
      case "heading_3":
        return `<h4>${richText}</h4>`;
      case "bulleted_list_item":
        return `<ul><li>${richText}</li></ul>`;
      case "numbered_list_item":
        return `<ol><li>${richText}</li></ol>`;
      case "quote":
        return `<blockquote>${richText}</blockquote>`;
      case "callout":
        return `<aside>${richText}</aside>`;
      case "divider":
        return "<hr>";
      case "code":
        return `<pre><code>${escapeHtml(this.propertyText(value as AnyProperty))}</code></pre>`;
      default:
        return "";
    }
  }

  private firstNonEmptyProperty(properties: Record<string, AnyProperty>, names: string[]): string {
    for (const name of names) {
      const value = this.propertyText(properties[name]);
      if (value) return value;
    }
    return "";
  }

  private propertyText(property?: AnyProperty): string {
    if (!property || typeof property.type !== "string") return "";
    const value = property[property.type] as unknown;

    if (Array.isArray(value)) return plainText(value as RichTextItem[]);
    if (property.type === "select" || property.type === "status") return String((value as { name?: string })?.name ?? "");
    if (property.type === "date") return String((value as { start?: string })?.start ?? "");
    if (property.type === "number") return property.number === null ? "" : String(property.number ?? "");
    if (property.type === "email" || property.type === "phone_number" || property.type === "url") {
      return String(value ?? "");
    }
    return "";
  }
}

interface RichTextItem {
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
}

function plainText(items: RichTextItem[]): string {
  return items.map((item) => item.plain_text ?? "").join("").trim();
}

function richTextToHtml(items: RichTextItem[]): string {
  return items
    .map((item) => {
      let text = escapeHtml(item.plain_text ?? "");
      if (item.annotations?.code) text = `<code>${text}</code>`;
      if (item.annotations?.bold) text = `<strong>${text}</strong>`;
      if (item.annotations?.italic) text = `<em>${text}</em>`;
      if (item.annotations?.underline) text = `<u>${text}</u>`;
      if (item.annotations?.strikethrough) text = `<s>${text}</s>`;
      if (item.href) text = `<a href="${escapeHtml(item.href)}">${text}</a>`;
      return text;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
