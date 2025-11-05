/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  PUBLIC_BASE_URL?: string;
  BASE_URL?: string;
}
