import "server-only";

import {createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";
import {cookies, headers} from "next/headers";
import {redirect} from "next/navigation";

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

function getSessionSecret(): string {
  const secret =
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";

  if (!secret) {
    throw new Error("缺少 ADMIN_SESSION_SECRET 或 SUPABASE_SERVICE_ROLE_KEY 环境变量");
  }

  return secret;
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
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

function serializeSession(session: AdminSession): string {
  const payload = encodeBase64Url(JSON.stringify(session));
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

function deserializeSession(cookieValue: string): AdminSession | null {
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = signPayload(payload);
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
  cookieStore.set(ADMIN_SESSION_COOKIE, serializeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
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
