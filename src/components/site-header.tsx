import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader({
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status?: string;
}) {
  return (
    <header className="flex min-h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
      <SidebarTrigger className="-ml-2" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          {status ? <Badge variant="outline">{status}</Badge> : null}
        </div>
        <p className="hidden truncate text-sm text-muted-foreground md:block">{description}</p>
      </div>
      <Button asChild variant="outline" size="sm" className="hidden sm:flex">
        <Link href="/">
          Public site
          <ArrowUpRightIcon data-icon="inline-end" />
        </Link>
      </Button>
    </header>
  );
}
