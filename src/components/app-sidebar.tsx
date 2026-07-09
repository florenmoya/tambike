"use client";

import * as React from "react";
import Link from "next/link";
import {
  BarChart3Icon,
  CheckSquareIcon,
  FileCheck2Icon,
  GaugeIcon,
  ShieldCheckIcon,
  UploadCloudIcon,
  UsersIcon,
  UserRoundCheckIcon,
  WarehouseIcon,
} from "lucide-react";

import type { AdminSection } from "@/features/admin/admin-console";
import type { UserProfile } from "@/features/tambike-demo/types";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type SidebarMetric = {
  pendingOrganizers: number;
  pendingEvents: number;
  venueClaims: number;
};

const primaryNav: Array<{
  title: string;
  href: string;
  section: AdminSection;
  icon: React.ReactNode;
  badge?: keyof SidebarMetric;
}> = [
  {
    title: "Overview",
    href: "/admin",
    section: "overview",
    icon: <GaugeIcon />,
  },
  {
    title: "Organizer verification",
    href: "/admin/verifications/organizers",
    section: "organizers",
    icon: <UserRoundCheckIcon />,
    badge: "pendingOrganizers",
  },
  {
    title: "Event review",
    href: "/admin/events/review",
    section: "events",
    icon: <FileCheck2Icon />,
    badge: "pendingEvents",
  },
  {
    title: "Venue claims",
    href: "/admin/venues/claims",
    section: "venues",
    icon: <WarehouseIcon />,
    badge: "venueClaims",
  },
  {
    title: "Reports",
    href: "/admin/reports",
    section: "reports",
    icon: <BarChart3Icon />,
  },
];

const dataNav: Array<{
  title: string;
  href: string;
  section: AdminSection;
  icon: React.ReactNode;
}> = [
  {
    title: "Users",
    href: "/admin/users",
    section: "users",
    icon: <UsersIcon />,
  },
  {
    title: "Leads & validation",
    href: "/admin/leads",
    section: "validation",
    icon: <UploadCloudIcon />,
  },
  {
    title: "Moderation",
    href: "/admin/moderation",
    section: "moderation",
    icon: <CheckSquareIcon />,
  },
];

export function AppSidebar({
  currentSection,
  metrics,
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  currentSection: AdminSection;
  metrics: SidebarMetric;
  user: UserProfile;
}) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/admin">
                <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                  <ShieldCheckIcon className="size-4" />
                </div>
                <div className="grid text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Tambike Ops</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">Admin console</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={currentSection === item.section}
                    tooltip={item.title}
                  >
                    <Link href={item.href}>
                      {item.icon}
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.badge && metrics[item.badge] > 0 ? (
                    <SidebarMenuBadge>{metrics[item.badge]}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Data control</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {dataNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={currentSection === item.section}
                    tooltip={item.title}
                  >
                    <Link href={item.href}>
                      {item.icon}
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/profile">
                <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
                  {user.displayName
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.displayName}</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">{user.email}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
