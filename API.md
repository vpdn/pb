# pb API Reference

## Base URL

```
https://pb.YOUR_SUBDOMAIN.workers.dev
```

## Authentication

All endpoints (except GET /f/{fileId}) require authentication via Bearer token:

```
Authorization: Bearer pb_1234567890abcdef
```

## Endpoints

### Upload File

Upload a new file to the service.

```http
POST /upload
Authorization: Bearer PB_API_KEY
Content-Type: multipart/form-data
```

**Request Body:**
- `file`: Binary file data (multipart/form-data)

**Response:**
```json
{
  "url": "https://pb.YOUR_SUBDOMAIN.workers.dev/f/abc123def456", 
  "fileId": "abc123def456",
  "size": 1024
}
```

**Status Codes:**
- `200 OK`: File uploaded successfully
- `401 Unauthorized`: Invalid or missing API key
- `413 Payload Too Large`: File exceeds size limit
- `500 Internal Server Error`: Upload failed

### Download File

Retrieve a previously uploaded file. No authentication required.

```http
GET /f/{fileId}
```

**Response:**
- Binary file data with appropriate Content-Type and Content-Disposition headers
- Original filename preserved in Content-Disposition header

**Status Codes:**
- `200 OK`: File retrieved successfully
- `404 Not Found`: File not found

### Delete File

Delete a file you uploaded.

```http
DELETE /f/{fileId}
Authorization: Bearer PB_API_KEY
```

**Response:**
```json
{
  "fileId": "abc123def456",
  "message": "File deleted successfully"
}
```

**Status Codes:**
- `200 OK`: File deleted successfully
- `401 Unauthorized`: Invalid or missing API key
- `403 Forbidden`: File not owned by this API key
- `404 Not Found`: File not found

### List Files

List all files uploaded with your API key.

```http
GET /list
Authorization: Bearer PB_API_KEY
```

**Response:**
```json
{
  "files": [
    {
      "fileId": "abc123def456",
      "originalName": "document.pdf",
      "size": 1024,
      "contentType": "application/pdf",
      "uploadedAt": "2023-12-01T10:30:00.000Z",
      "url": "https://pb.YOUR_SUBDOMAIN.workers.dev/f/abc123def456"
    }
  ]
}
```

**Status Codes:**
- `200 OK`: List retrieved successfully
- `401 Unauthorized`: Invalid or missing API key

## Error Responses

All error responses follow this format:

```json
{
  "error": "Error message description"
}
```

## Rate Limits

Rate limits are enforced by Cloudflare Workers:
- 1000 requests per minute per IP
- File size limits depend on your Cloudflare plan

## CORS

The API supports CORS for browser-based uploads. All endpoints include appropriate CORS headers.