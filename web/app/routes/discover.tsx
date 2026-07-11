import { defer, json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Await, useLoaderData } from "@remix-run/react";
import { Suspense } from "react";

import { DiscoverExplorer } from "../components/discover";
import { AppChrome } from "../components/ui";
import { parseDiscoverParams } from "../lib/discover-query";
import { fetchCategories, getApiOrigin } from "../lib/jm-rpc.server";

export const meta: MetaFunction = () => [{ title: "漫画发现 | JM Aura Remix" }];

type DiscoverPageData = {
  apiOrigin: string;
  query: ReturnType<typeof parseDiscoverParams>;
  discoverData: ReturnType<typeof loadDiscoverRouteData>;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const query = parseDiscoverParams(url.searchParams);

  if (url.searchParams.get("discover-retry") === "content") {
    return json(await loadDiscoverRouteData(request, query));
  }

  return defer({
    apiOrigin: getApiOrigin(request),
    query,
    discoverData: loadDiscoverRouteData(request, query),
  });
}

export default function DiscoverRoute() {
  const data = useLoaderData<typeof loader>() as unknown as DiscoverPageData;

  return (
    <AppChrome title="Aura" subtitle="目录浏览">
      <Suspense
        fallback={
          <DiscoverExplorer
            apiOrigin={data.apiOrigin}
            query={data.query}
            result={null}
            error={null}
            loading
          />
        }
      >
        <Await resolve={data.discoverData}>
          {(discoverData) => (
            <DiscoverExplorer
              apiOrigin={data.apiOrigin}
              query={data.query}
              result={discoverData.result}
              error={discoverData.error}
            />
          )}
        </Await>
      </Suspense>
    </AppChrome>
  );
}

async function loadDiscoverRouteData(
  request: Request,
  query: ReturnType<typeof parseDiscoverParams>,
) {
  let result = null;
  let error: string | null = null;

  try {
    result = await fetchCategories(request, query);
  } catch (discoverError) {
    error = discoverError instanceof Error ? discoverError.message : "发现服务暂时不可用";
  }

  return { result, error };
}
