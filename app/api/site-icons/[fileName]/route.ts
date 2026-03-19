import {readManagedSiteIcon} from "@/lib/site-icons";

interface RouteContext {
  params: Promise<{ fileName: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const {fileName} = await context.params;
    const {buffer, contentType} = await readManagedSiteIcon(fileName);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not Found", {status: 404});
  }
}
