export interface AppConfig {
  port: number;
  host: string;
  notionApiKey: string;
  notionVersion: string;
  gotenbergEndpoint: string;
  gotenbergUsername: string;
  gotenbergPassword: string;
  apiSecretToken: string;
  notionWebhookVerificationToken: string;
  triggerStatus: string;
  companyLogoUrl: string;
  companyName: string;
  clinicianName: string;
  headerWebsite: string;
  headerEmail: string;
  signatureImageUrl: string;
  signatureLabel: string;
  pdfProperty: string;
  statusProperty: string;
  successStatus: string;
  errorStatus: string;
  webhookDebugLogBody: boolean;
}

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(env("PORT", "3000")),
    host: env("HOST", "0.0.0.0"),
    notionApiKey: env("NOTION_API_KEY"),
    notionVersion: env("NOTION_VERSION", "2026-03-11"),
    gotenbergEndpoint: env("GOTENBERG_ENDPOINT", "http://gotenberg:3000").replace(/\/+$/, ""),
    gotenbergUsername: env("GOTENBERG_USERNAME"),
    gotenbergPassword: env("GOTENBERG_PASSWORD"),
    apiSecretToken: env("API_SECRET_TOKEN"),
    notionWebhookVerificationToken: env("NOTION_WEBHOOK_VERIFICATION_TOKEN"),
    triggerStatus: env("NOTION_TRIGGER_STATUS", "Generar PDF"),
    companyLogoUrl: env("COMPANY_LOGO_URL"),
    companyName: env("COMPANY_NAME", "Consulta clinica"),
    clinicianName: env("CLINICIAN_NAME"),
    headerWebsite: env("HEADER_WEBSITE", "divergentbrain.org"),
    headerEmail: env("HEADER_EMAIL", "info@divergentbrain.org"),
    signatureImageUrl: env("SIGNATURE_IMAGE_URL"),
    signatureLabel: env("SIGNATURE_LABEL", "Firma"),
    pdfProperty: env("NOTION_PDF_PROPERTY", "PDF generado"),
    statusProperty: env("NOTION_STATUS_PROPERTY", "Estado"),
    successStatus: env("NOTION_SUCCESS_STATUS", "PDF generado"),
    errorStatus: env("NOTION_ERROR_STATUS", "Error PDF"),
    webhookDebugLogBody: env("WEBHOOK_DEBUG_LOG_BODY").toLowerCase() === "true"
  };
}

export function validateRuntimeConfig(config: AppConfig): void {
  const missing = [
    ["NOTION_API_KEY", config.notionApiKey],
    ["GOTENBERG_ENDPOINT", config.gotenbergEndpoint],
    ["API_SECRET_TOKEN", config.apiSecretToken]
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.map(([key]) => key).join(", ")}`);
  }
}
