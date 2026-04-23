import Link from "next/link";
import {ChevronLeft, SearchX} from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-muted/30 shadow-sm backdrop-blur-sm">
        <SearchX className="h-10 w-10 text-muted-foreground" />
      </div>

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-5xl">
        页面不存在
      </h1>
      
      <p className="mb-8 max-w-md text-muted-foreground">
        你访问的页面不存在，或已经被移动。
      </p>

      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-transform hover:scale-105 active:scale-95"
      >
        <ChevronLeft className="h-4 w-4" />
        返回首页
      </Link>
    </div>
  );
}
