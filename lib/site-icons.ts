import "server-only";

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";

export const SITE_ICON_UPLOAD_FIELD_NAME = "site_icon_file";
export const SITE_ICON_ROUTE_PREFIX = "/api/site-icons/";
export const SITE_ICON_ACCEPT_ATTRIBUTE =
  ".png,.ico,.webp,.jpg,.jpeg,image/png,image/x-icon,image/vnd.microsoft.icon,image/webp,image/jpeg";
export const SITE_ICON_MAX_BYTES = 1024 * 1024;

const SITE_ICON_RELATIVE_DIRECTORY = path.join(".sisyphus", "local-data", "site-icons");
const INVALID_SITE_ICON_ERROR = "站点图标仅支持 PNG、ICO、WEBP 或 JPEG 文件";
const INVALID_SITE_ICON_CONTENT_ERROR =
  "上传的站点图标文件内容无效，请重新选择 PNG、ICO、WEBP 或 JPEG 文件";

const MIME_TYPE_TO_EXTENSION = new Map<string, string>([
  ["image/png", ".png"],
  ["image/x-icon", ".ico"],
  ["image/vnd.microsoft.icon", ".ico"],
  ["image/webp", ".webp"],
  ["image/jpeg", ".jpg"],
]);

const EXTENSION_TO_CONTENT_TYPE = new Map<string, string>([
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".webp", "image/webp"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

const ALLOWED_EXTENSIONS = new Set(EXTENSION_TO_CONTENT_TYPE.keys());

function getSiteIconDirectory(): string {
  return path.resolve(process.cwd(), SITE_ICON_RELATIVE_DIRECTORY);
}

function normalizeManagedFileName(fileName: string): string {
  const normalized = decodeURIComponent(fileName).trim();
  if (!normalized || normalized !== path.basename(normalized) || !/^[a-zA-Z0-9._-]+$/.test(normalized)) {
    throw new Error("非法站点图标文件名");
  }

  return normalized;
}

function resolveSiteIconExtension(file: File): string {
  const fromType = MIME_TYPE_TO_EXTENSION.get(file.type);
  if (fromType) {
    return fromType;
  }

  const fromName = path.extname(file.name ?? "").toLowerCase();
  if (ALLOWED_EXTENSIONS.has(fromName)) {
    return fromName;
  }

  throw new Error(INVALID_SITE_ICON_ERROR);
}

function getContentType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  return EXTENSION_TO_CONTENT_TYPE.get(extension) ?? "application/octet-stream";
}

function matchesPngSignature(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function matchesJpegSignature(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  );
}

function matchesIcoSignature(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    buffer[3] === 0x00
  );
}

function matchesWebpSignature(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  );
}

function validateSiteIconContent(buffer: Uint8Array, extension: string): void {
  const isValid =
    extension === ".png"
      ? matchesPngSignature(buffer)
      : extension === ".ico"
        ? matchesIcoSignature(buffer)
        : extension === ".webp"
          ? matchesWebpSignature(buffer)
          : extension === ".jpg" || extension === ".jpeg"
            ? matchesJpegSignature(buffer)
            : false;

  if (!isValid) {
    throw new Error(INVALID_SITE_ICON_CONTENT_ERROR);
  }
}

export function ensureUploadedSiteIcon(entry: FormDataEntryValue | null): File {
  if (!(entry instanceof File) || entry.size === 0) {
    throw new Error("请先选择一个站点图标文件");
  }

  if (entry.size > SITE_ICON_MAX_BYTES) {
    throw new Error("站点图标不能超过 1 MB");
  }

  resolveSiteIconExtension(entry);
  return entry;
}

export async function saveUploadedSiteIcon(file: File): Promise<string> {
  const extension = resolveSiteIconExtension(file);
  const directory = getSiteIconDirectory();
  await mkdir(directory, {recursive: true});

  const fileName = `site-icon-${Date.now()}-${randomUUID()}${extension}`;
  const absolutePath = path.join(directory, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());

  validateSiteIconContent(buffer, extension);

  await writeFile(absolutePath, buffer);
  return `${SITE_ICON_ROUTE_PREFIX}${fileName}`;
}

export function isManagedSiteIconUrl(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(SITE_ICON_ROUTE_PREFIX));
}

export function extractManagedSiteIconFileName(value: string | null | undefined): string | null {
  if (!isManagedSiteIconUrl(value)) {
    return null;
  }

  const relative = value!.slice(SITE_ICON_ROUTE_PREFIX.length).split("?")[0];
  if (!relative) {
    return null;
  }

  try {
    return normalizeManagedFileName(relative);
  } catch {
    return null;
  }
}

export async function deleteManagedSiteIconByUrl(value: string | null | undefined): Promise<void> {
  const fileName = extractManagedSiteIconFileName(value);
  if (!fileName) {
    return;
  }

  const absolutePath = path.join(getSiteIconDirectory(), fileName);
  await rm(absolutePath, {force: true});
}

export async function readManagedSiteIcon(fileName: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const normalizedFileName = normalizeManagedFileName(fileName);
  const absolutePath = path.join(getSiteIconDirectory(), normalizedFileName);
  const buffer = await readFile(absolutePath);

  return {
    buffer,
    contentType: getContentType(normalizedFileName),
  };
}
