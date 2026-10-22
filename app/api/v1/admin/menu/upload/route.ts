import { NextResponse } from "next/server";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { badRequest } from "@/lib/http/errors";
import { saveUploadedImage } from "@/lib/security/uploads";

/** POST multipart/form-data { file } — validated image upload (type sniffed, 2 MB max, random name). */
export const POST = staffRoute({ permission: PERMISSIONS.MENU_MANAGE }, async ({ req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw badRequest("Attach an image file");
  return NextResponse.json(await saveUploadedImage(file), { status: 201 });
});
