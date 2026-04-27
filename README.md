# Notion Patient PDF Automator

Servicio Fastify en Node.js 20 + TypeScript para generar informes PDF profesionales desde paginas de Notion, convertir el HTML con Gotenberg y adjuntar el PDF final al expediente del paciente en Notion.

## Flujo

```text
N8N
  -> POST /generate-pdf con page_id
  -> Fastify valida API_SECRET_TOKEN
  -> Notion API lee propiedades y bloques de la pagina
  -> Plantilla HTML/CSS corporativa
  -> Gotenberg convierte a PDF
  -> Notion API sube el PDF y lo adjunta
  -> Estado = PDF generado
```

Tambien puede funcionar sin N8N:

```text
Notion webhook
  -> POST /notion-webhook
  -> si Estado = Generar PDF, genera el PDF
  -> adjunta el archivo en Notion
  -> Estado = PDF generado
```

## Variables de entorno

Obligatorias en Coolify:

```text
NOTION_API_KEY=ntn_xxx
GOTENBERG_ENDPOINT=http://gotenberg:3000
API_SECRET_TOKEN=secret_compartido_con_n8n
COMPANY_LOGO_URL=https://tu-dominio.com/logo.png
PORT=3000
```

Opcionales:

```text
NOTION_VERSION=2026-03-11
GOTENBERG_USERNAME=
GOTENBERG_PASSWORD=
NOTION_WEBHOOK_VERIFICATION_TOKEN=
NOTION_TRIGGER_STATUS=Generar PDF
NOTION_PDF_PROPERTY=PDF generado
NOTION_STATUS_PROPERTY=Estado
NOTION_SUCCESS_STATUS=PDF generado
NOTION_ERROR_STATUS=Error PDF
COMPANY_NAME=Tu clinica
CLINICIAN_NAME=Nombre del profesional
```

`NOTION_PDF_PROPERTY` debe ser una propiedad de Notion tipo `Files`. Si quieres adjuntar el PDF como bloque al final de la pagina, deja esta variable vacia.

## Endpoint para N8N

```http
POST /generate-pdf
Authorization: Bearer <API_SECRET_TOKEN>
Content-Type: application/json
```

Payload:

```json
{
  "page_id": "ID_DE_LA_PAGINA_DE_NOTION"
}
```

## Webhook directo desde Notion

Configura en la integracion de Notion esta URL:

```text
https://TU-APP.coolify.com/notion-webhook
```

Eventos recomendados:

```text
page.content_updated
page.properties_updated
```

Cuando crees la suscripcion, Notion enviara un `verification_token`. La app lo escribe en los logs de Coolify. Copialo, pegalo en el formulario de verificacion de Notion y guardalo despues como:

```text
NOTION_WEBHOOK_VERIFICATION_TOKEN=secret_xxx
```

Para disparar la generacion desde Notion, cambia la propiedad:

```text
Estado = Generar PDF
```

La app ignorara cualquier webhook cuyo estado no sea `Generar PDF`. Esto evita que el webhook se ejecute en bucle cuando el servicio adjunta el PDF y cambia el estado a `PDF generado`.

Respuesta correcta:

```json
{
  "status": "ok",
  "pageId": "ID_DE_LA_PAGINA_DE_NOTION",
  "filename": "Informe-2026-04-27.pdf",
  "fileUploadId": "file-upload-id",
  "pdfBytes": 123456
}
```

## Desarrollo local

```powershell
cd "apps\notion-pdf-reports"
npm.cmd install
npm.cmd run dev
```

Health check:

```text
http://127.0.0.1:3000/health
```

## Build

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd start
```

## Docker / Coolify

El `Dockerfile` compila TypeScript y ejecuta:

```text
node dist/src/server.js
```

Para levantar app + Gotenberg en local:

```powershell
docker compose up --build
```

En Coolify puedes desplegar el servicio desde este directorio y crear Gotenberg como servicio adicional, usando `GOTENBERG_ENDPOINT=http://gotenberg:3000` si comparten la misma red.
