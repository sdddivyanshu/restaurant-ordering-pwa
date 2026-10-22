import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "@/lib/env";
import { badRequest } from "@/lib/http/errors";
import { randomToken } from "@/lib/security/tokens";

const MAX_BYTES = 2 * 1024 * 1024;
const NAME_RE = /^[A-Za-z0-9_-]{16,40}\.(png|jpg|webp)$/;
const TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

/** Detect the real image type from magic bytes — the client-provided MIME type is ignored. */
export function sniffImage(buf: Uint8Array): keyof typeof TYPES | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 12 && String.fromCharCode(...buf.slice(0, 4)) === "RIFF" && String.fromCharCode(...buf.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

export async function saveUploadedImage(file: File) {
  if (file.size > MAX_BYTES) throw badRequest("Image must be 2 MB or smaller");
  const buf = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(buf);
  if (!ext) throw badRequest("Only PNG, JPEG or WebP images are allowed");
  const name = `${randomToken(16)}.${ext}`;
  const dir = path.resolve(uploadDir());
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buf);
  return { url: `/api/v1/public/images/${name}` };
}

export async function readUploadedImage(name: string) {
  if (!NAME_RE.test(name)) return null;
  const ext = name.split(".").pop() as keyof typeof TYPES;
  try {
    const data = await readFile(path.join(path.resolve(uploadDir()), name));
    return { data, contentType: TYPES[ext] };
  } catch {
    return null;
  }
}
