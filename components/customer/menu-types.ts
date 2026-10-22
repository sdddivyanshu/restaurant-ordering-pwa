import type { PublicMenu, PublicMenuItem } from "@/lib/menu/service";

export type Menu = PublicMenu;
export type MenuItemView = PublicMenuItem;
export type MenuGroup = MenuItemView["groups"][number];
