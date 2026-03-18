import {redirect} from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminSupabaseAliasPage() {
  redirect("/admin/storage");
}
