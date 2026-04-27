export interface ReportPatient {
  name: string;
  identifier?: string;
}

export interface ReportMetadata {
  title: string;
  date: string;
  status?: string;
  patient: ReportPatient;
}

export interface ReportContent {
  html: string;
}

export interface MedicalReport {
  metadata: ReportMetadata;
  content: ReportContent;
  sourcePageId: string;
}

export interface GeneratePdfResult {
  status: "ok";
  pageId: string;
  filename: string;
  fileUploadId: string;
  pdfBytes: number;
}
