import {NextResponse} from "next/server";

import {clearAdminSession} from "@/lib/admin/auth";

export async function POST(request: Request) {
  await clearAdminSession();

  const url = new URL(
    "/admin/login?notice=%E5%B7%B2%E9%80%80%E5%87%BA%E7%99%BB%E5%BD%95&noticeType=success",
    request.url
  );
  return NextResponse.redirect(url, {status: 303});
}
