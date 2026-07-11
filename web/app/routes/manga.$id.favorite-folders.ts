import { json, type LoaderFunctionArgs } from "@remix-run/node";

import { fetchFavorites } from "../lib/jm-rpc.server";

export const favoriteFoldersRouteDependencies = {
  fetchFavorites,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const favorites = await favoriteFoldersRouteDependencies.fetchFavorites(request, {
    page: 1,
    folder_id: "0",
    page_size: 10,
  });

  return json({
    folders: favorites.folder_list,
  });
}
