import type { Image } from "../../../packages/shared/src/schema";

export function buildImageProxyUrl(apiOrigin: string, image: Image, format: "jpeg" | "webp" = "webp"): string {
  const params = new URLSearchParams({
    url: image.download_url,
    scramble_id: image.scramble_id,
    aid: image.aid,
    img_file_name: image.img_file_name,
    decrypt: "true",
    format,
  });

  return `${apiOrigin}/api/image/proxy?${params.toString()}`;
}

export function buildPassthroughImageUrl(apiOrigin: string, url: string, format: "jpeg" | "webp" = "webp"): string {
  const params = new URLSearchParams({
    url,
    decrypt: "false",
    format,
  });

  return `${apiOrigin}/api/image/proxy?${params.toString()}`;
}
