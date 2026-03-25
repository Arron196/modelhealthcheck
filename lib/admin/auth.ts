import "server-only";

import {createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual} from "node:crypto";
import {isIP} from "node:net";
import {promisify} from "node:util";
import {cookies, headers} from "next/headers";
import {redirect} from "next/navigation";

import {
  ensureBootstrapAdminSessionSecret,
  getBootstrapAdminSessionSecret,
} from "@/lib/storage/bootstrap-store";
import {getControlPlaneStorage} from "@/lib/storage/resolver";
import type {AdminUserRecord} from "@/lib/storage/types";

const scryptAsync = promisify(scryptCallback);
const ADMIN_SESSION_COOKIE = "check-cx-admin-session";
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type AdminUserRow = AdminUserRecord;

export interface AdminSession {
  userId: string;
  username: string;
  expiresAt: number;
}

interface TurnstileVerificationResult {
  success: boolean;
  action?: string;
  hostname?: string;
  [key: string]: unknown;
}

async function getSessionSecret(input?: {createIfMissing?: boolean}): Promise<string | null> {
  const envSecret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (envSecret) {
    return envSecret;
  }

  const supabaseFallback = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (supabaseFallback) {
    return supabaseFallback;
  }

  const bootstrapSecret = getBootstrapAdminSessionSecret();
  if (bootstrapSecret) {
    return bootstrapSecret;
  }

  if (input?.createIfMissing) {
    return ensureBootstrapAdminSessionSecret();
  }

  return null;
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function getPrimaryHeaderValue(value: string | null): string | null {
  const normalized = value?.split(",")[0]?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function parseForwardedProto(forwarded: string | null): "http" | "https" | null {
  if (!forwarded) {
    return null;
  }

  const match = forwarded.match(/proto=(https?|wss?)/i);
  if (!match) {
    return null;
  }

  return match[1].startsWith("https") || match[1].startsWith("wss") ? "https" : "http";
}

function extractHostname(host: string | null): string | null {
  const normalized = host?.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("[")) {
    const closingBracketIndex = normalized.indexOf("]");
    if (closingBracketIndex === -1) {
      return normalized.slice(1).toLowerCase();
    }
    return normalized.slice(1, closingBracketIndex).toLowerCase();
  }

  return normalized.split(":")[0]?.trim().toLowerCase() || null;
}

function isDirectHost(hostname: string | null): boolean {
  if (!hostname) {
    return false;
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1") {
    return true;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return true;
  }

  return ipVersion === 6;
}

async function shouldUseSecureSessionCookie(): Promise<boolean> {
  const headerStore = await headers();
  const forwardedProto = getPrimaryHeaderValue(headerStore.get("x-forwarded-proto"));
  if (forwardedProto === "http" || forwardedProto === "https") {
    return forwardedProto === "https";
  }

  const standardizedForwardedProto = parseForwardedProto(headerStore.get("forwarded"));
  if (standardizedForwardedProto) {
    return standardizedForwardedProto === "https";
  }

  const cfVisitor = headerStore.get("cf-visitor");
  if (cfVisitor?.includes('"scheme":"https"')) {
    return true;
  }
  if (cfVisitor?.includes('"scheme":"http"')) {
    return false;
  }

  const originLikeHeader = headerStore.get("origin") ?? headerStore.get("referer");
  if (originLikeHeader) {
    try {
      return new URL(originLikeHeader).protocol === "https:";
    } catch {
    }
  }

  const host = extractHostname(headerStore.get("x-forwarded-host") ?? headerStore.get("host"));
  if (isDirectHost(host)) {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

async function signPayload(payload: string, input?: {createIfMissing?: boolean}): Promise<string> {
  const secret = await getSessionSecret(input);
  if (!secret) {
    throw new Error("当前无法生成管理员会话签名，请先完成初始化或配置 ADMIN_SESSION_SECRET");
  }

  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateUsername(username: string): string {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) {
    throw new Error("用户名需为 3-32 位，仅支持小写字母、数字、点、下划线和中划线");
  }

  return normalized;
}

function validatePassword(password: string): string {
  if (password.length < 8) {
    throw new Error("密码至少需要 8 位");
  }

  return password;
}

export function getTurnstileSiteKey(): string | null {
  const value = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return value ? value : null;
}

function getTurnstileSecretKey(): string | null {
  const value = process.env.TURNSTILE_SECRET_KEY?.trim();
  return value ? value : null;
}

export function isTurnstileEnabled(): boolean {
  return Boolean(getTurnstileSiteKey() && getTurnstileSecretKey());
}

export async function hashAdminPassword(password: string): Promise<string> {
  const validated = validatePassword(password);
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(validated, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyAdminPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, salt, digest] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !digest) {
    return false;
  }

  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  const originalKey = Buffer.from(digest, "hex");

  if (derivedKey.length !== originalKey.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, originalKey);
}

async function serializeSession(session: AdminSession): Promise<string> {
  const payload = encodeBase64Url(JSON.stringify(session));
  const signature = await signPayload(payload, {createIfMissing: true});
  return `${payload}.${signature}`;
}

async function deserializeSession(cookieValue: string): Promise<AdminSession | null> {
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) {
    return null;
  }

  const secret = await getSessionSecret();
  if (!secret) {
    return null;
  }

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== signatureBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as AdminSession;
    if (!parsed.userId || !parsed.username || !parsed.expiresAt) {
      return null;
    }
    if (parsed.expiresAt <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function setSessionCookie(session: AdminSession): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, await serializeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: await shouldUseSecureSessionCookie(),
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!sessionCookie) {
    return null;
  }

  return deserializeSession(sessionCookie);
}

export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  return session;
}

export async function hasAdminUsers(): Promise<boolean> {
  const storage = await getControlPlaneStorage();
  return storage.adminUsers.hasAny();
}

async function getAdminUserByUsername(username: string): Promise<AdminUserRow | null> {
  const normalized = normalizeUsername(username);
  const storage = await getControlPlaneStorage();
  return storage.adminUsers.findByUsername(normalized);
}

export async function createInitialAdminUser(input: {
  username: string;
  password: string;
}): Promise<AdminSession> {
  if (await hasAdminUsers()) {
    throw new Error("管理员账户已存在，请直接登录");
  }

  const username = validateUsername(input.username);
  const passwordHash = await hashAdminPassword(input.password);
  const storage = await getControlPlaneStorage();
  const createdUser = await storage.adminUsers.create({
    username,
    passwordHash,
    lastLoginAt: new Date().toISOString(),
  });

  const session = {
    userId: createdUser.id,
    username: createdUser.username,
    expiresAt: Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
  } satisfies AdminSession;

  await setSessionCookie(session);
  return session;
}

export async function authenticateAdminUser(input: {
  username: string;
  password: string;
}): Promise<AdminSession> {
  if (!(await hasAdminUsers())) {
    throw new Error("当前还没有管理员账户，请先完成首次初始化");
  }

  const username = validateUsername(input.username);
  const user = await getAdminUserByUsername(username);
  if (!user) {
    throw new Error("用户名或密码错误");
  }

  const valid = await verifyAdminPassword(input.password, user.password_hash);
  if (!valid) {
    throw new Error("用户名或密码错误");
  }

  const session = {
    userId: user.id,
    username: user.username,
    expiresAt: Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
  } satisfies AdminSession;

  const storage = await getControlPlaneStorage();
  await storage.adminUsers.updateLastLoginAt(user.id, new Date().toISOString());

  await setSessionCookie(session);
  return session;
}

export async function ensureLoggedOutForLoginPage(): Promise<void> {
  const session = await getAdminSession();
  if (session) {
    redirect("/admin");
  }
}

export async function verifyTurnstile(formData: FormData, expectedAction: string): Promise<void> {
  if (!isTurnstileEnabled()) {
    return;
  }

  const token = formData.get("cf-turnstile-response");
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("请完成人机验证");
  }

  const headerStore = await headers();
  const forwardedFor = headerStore.get("cf-connecting-ip") ?? headerStore.get("x-forwarded-for") ?? "";
  const remoteip = forwardedFor.split(",")[0]?.trim() || undefined;
  const verificationResponse = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret: getTurnstileSecretKey(),
        response: token,
        remoteip,
        idempotency_key: randomUUID(),
      }),
      cache: "no-store",
    }
  );

  if (!verificationResponse.ok) {
    throw new Error("人机验证服务暂时不可用，请稍后重试");
  }

  const result = (await verificationResponse.json()) as TurnstileVerificationResult;
  if (!result.success) {
    throw new Error("人机验证失败，请刷新后重试");
  }
  if (result.action && result.action !== expectedAction) {
    throw new Error("人机验证动作不匹配，请重试");
  }
}
