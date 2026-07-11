import { json, type LoaderFunctionArgs } from "@remix-run/node";

import { fetchManga } from "../lib/jm-rpc.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const mangaId = params.id?.trim();

  if (!mangaId) {
    return json({ manga: null }, { status: 400 });
  }

  const manga = await fetchManga(request, mangaId);

  return json({
    manga: {
      album_id: manga.album_id,
      name: manga.name,
      image: manga.image,
      author: manga.author,
      tags: manga.tags,
    },
  });
}
