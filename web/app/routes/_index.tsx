import { defer, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import { HomeReadingHub } from "../components/home";
import { AppChrome } from "../components/ui";
import { createEmptyHomeSections } from "../lib/home.server";
import {
  createHomeStreamPayload,
  resolveContinueReadingSegment,
} from "../lib/home-stream";
import {
  fetchHomeLatest,
  fetchRankingsMonth,
  fetchRankingsToday,
  fetchRankingsWeek,
  getApiOrigin,
} from "../lib/jm-rpc.server";

export const meta: MetaFunction = () => [{ title: "JM Aura Remix | 漫画首页" }];

export async function loader({ request }: LoaderFunctionArgs) {
  return defer({
    apiOrigin: getApiOrigin(request),
    entryPoints: createEmptyHomeSections().entryPoints,
    ...loadHomeStreamRouteData(request),
  });
}

export default function IndexRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <AppChrome title="Aura" subtitle="漫画内容首页">
      <HomeReadingHub
        apiOrigin={data.apiOrigin}
        entryPoints={data.entryPoints}
        stream={{
          continueReading: data.continueReading,
          latest: data.latest,
          rankingToday: data.rankingToday,
          rankingWeek: data.rankingWeek,
          rankingMonth: data.rankingMonth,
        }}
      />
    </AppChrome>
  );
}

function loadHomeStreamRouteData(request: Request) {
  const latest = () => fetchHomeLatest(request);
  const rankingToday = () =>
    fetchRankingsToday(request).then((result) => result.content);
  const rankingWeek = () =>
    fetchRankingsWeek(request).then((result) => result.content);
  const rankingMonth = () =>
    fetchRankingsMonth(request).then((result) => result.content);

  return createHomeStreamPayload({
    continueReading: () =>
      resolveContinueReadingSegment({
        latest,
        rankingToday,
        rankingWeek,
        rankingMonth,
      }),
    latest,
    rankingToday,
    rankingWeek,
    rankingMonth,
  });
}
