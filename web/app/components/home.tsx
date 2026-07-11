import { Await, Form, Link, useFetcher } from "@remix-run/react";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import type { SearchResultItem } from "../../../packages/shared/src/schema";
import type { HomeEntryPoint } from "../lib/home.server";
import {
  buildHistoryContinueReadingSegment,
  getHomeStreamSectionMeta,
  type HomeContinueReadingSegment,
  type HomeStreamDataKey,
  type HomeStreamPayload,
} from "../lib/home-stream";
import { buildPassthroughImageUrl } from "../lib/jm-media";
import { readStoredReadingState } from "../lib/reading-state";
import {
  ContinueReadingSkeleton,
  HomeGridSkeleton,
  RankingPanelSkeleton,
} from "./loading";
import {
  CoverArtwork,
  DocumentNavigationLink,
  MediaGrid,
  SectionHeader,
  SiteToolbar,
  StatusPanel,
  TagPill,
} from "./ui";

type RankingCard = {
  key: "rankingToday" | "rankingWeek" | "rankingMonth";
  title: string;
  href: string;
};

const RANKING_CARDS: RankingCard[] = [
  { key: "rankingToday", title: "今日热门", href: "/search?order_by=mv&time=t" },
  { key: "rankingWeek", title: "本周热门", href: "/search?order_by=mv&time=w" },
  { key: "rankingMonth", title: "本月热门", href: "/search?order_by=mv&time=m" },
];

type HomeSectionRetryData = Partial<{
  [Key in HomeStreamDataKey]: Awaited<HomeStreamPayload[Key]> | HomeStreamPayload[Key];
}>;

type RetryableHomeSectionProps<SectionKey extends HomeStreamDataKey> = {
  sectionKey: SectionKey;
  resolve: HomeStreamPayload[SectionKey];
  fallback: ReactNode;
  render: (value: Awaited<HomeStreamPayload[SectionKey]>) => ReactNode;
  renderError: (controls: {
    onRetry: () => void;
    retrying: boolean;
  }) => ReactNode;
};

export function ContinueReadingMini(props: {
  item: SearchResultItem | null;
  sourceLabel: string;
  href: string;
  actionLabel: string;
}) {
  return (
    <section className="home-continue-mini">
      <div className="home-continue-mini__copy">
        <span className="home-continue-mini__label">继续阅读</span>
        <span className="home-continue-mini__label">{props.sourceLabel}</span>
        <Link
          className="home-continue-mini__title"
          prefetch="intent"
          to={props.href}
        >
          {props.item?.name ?? "从最新内容开始"}
        </Link>
      </div>

      {props.item ? (
        <div className="home-continue-mini__tags">
          {props.item.author ? <span className="md-chip">作者：{props.item.author}</span> : null}
          {props.item.tags.slice(0, 2).map((tag) => <TagPill key={tag}>{tag}</TagPill>)}
        </div>
      ) : null}

      <div className="home-continue-mini__actions">
        <Link
          className="md-button md-button--primary"
          prefetch="intent"
          to={props.href}
        >
          {props.actionLabel}
        </Link>
        <Link className="md-button md-button--surface" prefetch="intent" to="/discover">
          分类
        </Link>
      </div>
    </section>
  );
}

function ContinueReadingPanel(props: {
  initialSegment: HomeContinueReadingSegment;
}) {
  const [segment, setSegment] = useState(props.initialSegment);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const readingState = readStoredReadingState(window.localStorage);
    if (!readingState) {
      return;
    }

    let cancelled = false;

    void fetch(`/api/continue-reading/${encodeURIComponent(readingState.mangaId)}`)
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        return (await response.json()) as {
          manga?: {
            album_id: string;
            name: string;
            image: string | null;
            author: string;
            tags: string[];
          } | null;
        };
      })
      .then((payload) => {
        if (cancelled || !payload?.manga) {
          return;
        }

        const nextSegment = buildHistoryContinueReadingSegment(readingState, payload.manga);
        if (nextSegment) {
          setSegment(nextSegment);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ContinueReadingMini
      item={segment.item}
      sourceLabel={segment.sourceLabel}
      href={segment.href}
      actionLabel={segment.actionLabel}
    />
  );
}

export function HomeReadingHub(props: {
  entryPoints: HomeEntryPoint[];
  apiOrigin: string;
  stream: HomeStreamPayload;
}) {
  return (
    <div className="home-stream">
      <SiteToolbar
        className="home-site-toolbar"
        title="JM-Aura-Remix"
        aside={
          <div className="home-site-toolbar__aside-stack">
            <RetryableHomeSection
              sectionKey="continueReading"
              resolve={props.stream.continueReading}
              fallback={<ContinueReadingSkeleton />}
              render={(segment) => (
                <ContinueReadingPanel initialSegment={segment} />
              )}
              renderError={({ onRetry, retrying }) => (
                <ContinueReadingError onRetry={onRetry} retrying={retrying} />
              )}
            />
          </div>
        }
      >
        <div className="home-site-toolbar__lead">
          <QuickSearchInline />
          <div className="home-entry-grid">
            {props.entryPoints.map((item) => (
              <EntryPointCard key={item.key} item={item} />
            ))}
          </div>
        </div>
      </SiteToolbar>

      <RetryableHomeSection
        sectionKey="latest"
        resolve={props.stream.latest}
        fallback={
          <HomeGridSkeleton count={12} title="最新更新" description="正在同步" />
        }
        render={(items) => <LatestSection apiOrigin={props.apiOrigin} items={items} />}
        renderError={({ onRetry, retrying }) => (
          <LatestSectionError onRetry={onRetry} retrying={retrying} />
        )}
      />

      <section className="home-ranking-section">
        <SectionHeader
          eyebrow="热门"
          title="热度榜"
          description="今日 / 本周 / 本月"
        />

        <div className="home-ranking-grid">
          {RANKING_CARDS.map((card) => (
            <RankingStreamPanel
              key={card.key}
              sectionKey={card.key}
              title={card.title}
              href={card.href}
              resolve={props.stream[card.key]}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function RetryableHomeSection<SectionKey extends HomeStreamDataKey>(
  props: RetryableHomeSectionProps<SectionKey>,
) {
  const fetcher = useFetcher<HomeSectionRetryData>();
  const meta = getHomeStreamSectionMeta(props.sectionKey);
  const isRetrying = fetcher.state !== "idle";
  const retriedResolve = fetcher.data?.[props.sectionKey] as
    | Awaited<HomeStreamPayload[SectionKey]>
    | HomeStreamPayload[SectionKey]
    | undefined;
  const resolve = Promise.resolve(
    (retriedResolve ?? props.resolve) as
      | Awaited<HomeStreamPayload[SectionKey]>
      | HomeStreamPayload[SectionKey],
  );

  if (isRetrying) {
    return <>{props.fallback}</>;
  }

  return (
    <Suspense fallback={props.fallback}>
      <Await
        resolve={resolve}
        errorElement={props.renderError({
          onRetry: () =>
            fetcher.load(
              `/?index&home-retry=${encodeURIComponent(meta.queryValue)}&nonce=${Date.now()}`,
            ),
          retrying: isRetrying,
        })}
      >
        {(value) => props.render(value)}
      </Await>
    </Suspense>
  );
}

function EntryPointCard(props: { item: HomeEntryPoint }) {
  return (
    <Link className="home-entry-card" prefetch="intent" to={props.item.href}>
      <span className="home-entry-card__icon material-symbols-rounded" aria-hidden="true">
        {props.item.icon}
      </span>
      <span className="home-entry-card__copy">
        <span className="home-entry-card__label">{props.item.label}</span>
        <span className="home-entry-card__meta">{props.item.description}</span>
      </span>
    </Link>
  );
}

function HomeFeedCard(props: {
  item: SearchResultItem;
  apiOrigin: string;
}) {
  const coverUrl =
    props.item.image != null
      ? buildPassthroughImageUrl(props.apiOrigin, props.item.image, "webp")
      : null;

  return (
    <DocumentNavigationLink className="home-card" to={`/manga/${props.item.id}`}>
      <div className="home-card__media">
        <CoverArtwork src={coverUrl} title={props.item.name} aspectRatio="3/4" size="compact" />
      </div>
      <div className="home-card__content">
        <h3 className="home-card__title">{props.item.name}</h3>
        <p className="home-card__meta">{props.item.author ?? props.item.tags[0] ?? "未知作者"}</p>
        <div className="home-card__tags">
          {props.item.tags.slice(0, 2).map((tag) => <TagPill key={tag}>{tag}</TagPill>)}
        </div>
      </div>
    </DocumentNavigationLink>
  );
}

function LatestSection(props: {
  items: SearchResultItem[];
  apiOrigin: string;
}) {
  return (
    <section className="home-flow">
      <SectionHeader
        eyebrow="最新"
        title="最新更新"
        description={`${props.items.length} 条`}
        action={
          <Link className="md-button md-button--surface" prefetch="intent" to="/search?order_by=mr">
            查看更多
          </Link>
        }
      />

      {props.items.length > 0 ? (
        <MediaGrid className="media-grid--home">
          {props.items.slice(0, 12).map((item) => (
            <HomeFeedCard key={item.id} apiOrigin={props.apiOrigin} item={item} />
          ))}
        </MediaGrid>
      ) : (
        <StatusPanel
          title="暂时还没有最新更新"
          description="先切到热门或分类入口。"
          action={
            <Link className="md-button md-button--primary" prefetch="intent" to="/discover">
              去分类
            </Link>
          }
        />
      )}
    </section>
  );
}

function ContinueReadingError(props: {
  onRetry: () => void;
  retrying: boolean;
}) {
  const meta = getHomeStreamSectionMeta("continueReading");

  return (
    <StatusPanel
      tone="error"
      title={meta.errorTitle}
      description={meta.errorDescription}
      action={
        <button
          type="button"
          className="md-button md-button--primary home-section-retry"
          onClick={props.onRetry}
          disabled={props.retrying}
        >
          {meta.retryLabel}
        </button>
      }
    />
  );
}

function LatestSectionError(props: {
  onRetry: () => void;
  retrying: boolean;
}) {
  const meta = getHomeStreamSectionMeta("latest");

  return (
    <section className="home-flow">
      <SectionHeader
        eyebrow="最新"
        title={meta.title}
        description="同步失败"
        action={
          <Link className="md-button md-button--surface" prefetch="intent" to="/search?order_by=mr">
            查看更多
          </Link>
        }
      />

      <StatusPanel
        tone="error"
        title={meta.errorTitle}
        description={meta.errorDescription}
        action={
          <button
            type="button"
            className="md-button md-button--primary home-section-retry"
            onClick={props.onRetry}
            disabled={props.retrying}
          >
            {meta.retryLabel}
          </button>
        }
      />
    </section>
  );
}

function RankingPanel(props: {
  title: string;
  href: string;
  items: SearchResultItem[];
}) {
  return (
    <section className="home-ranking-panel">
      <header className="home-ranking-panel__header">
        <h3 className="home-ranking-panel__title">{props.title}</h3>
        <Link className="home-ranking-panel__action" prefetch="intent" to={props.href}>
          更多
        </Link>
      </header>

      {props.items.length > 0 ? (
        <div className="home-ranking-list">
          {props.items.slice(0, 5).map((item, index) => (
            <DocumentNavigationLink
              key={item.id}
              className="home-ranking-item"
              to={`/manga/${item.id}`}
            >
              <span className="home-ranking-item__index">{index + 1}</span>
              <span className="home-ranking-item__copy">
                <span className="home-ranking-item__title">{item.name}</span>
                <span className="home-ranking-item__meta">
                  {item.author ?? item.tags[0] ?? "热门内容"}
                </span>
              </span>
            </DocumentNavigationLink>
          ))}
        </div>
      ) : (
        <StatusPanel
          title={`${props.title}暂时为空`}
          description="稍后再刷新。"
        />
      )}
    </section>
  );
}

function RankingStreamPanel(props: {
  sectionKey: "rankingToday" | "rankingWeek" | "rankingMonth";
  title: string;
  href: string;
  resolve: Promise<SearchResultItem[]>;
}) {
  return (
    <RetryableHomeSection
      sectionKey={props.sectionKey}
      resolve={props.resolve}
      fallback={<RankingPanelSkeleton title={props.title} />}
      render={(items) => (
        <RankingPanel title={props.title} href={props.href} items={items} />
      )}
      renderError={({ onRetry, retrying }) => (
        <RankingPanelState
          sectionKey={props.sectionKey}
          title={props.title}
          href={props.href}
          onRetry={onRetry}
          retrying={retrying}
        />
      )}
    />
  );
}

function RankingPanelState(props: {
  sectionKey: "rankingToday" | "rankingWeek" | "rankingMonth";
  title: string;
  href: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const meta = getHomeStreamSectionMeta(props.sectionKey);

  return (
    <section className="home-ranking-panel">
      <header className="home-ranking-panel__header">
        <h3 className="home-ranking-panel__title">{props.title}</h3>
        <Link className="home-ranking-panel__action" prefetch="intent" to={props.href}>
          更多
        </Link>
      </header>

      <StatusPanel
        tone="error"
        title={meta.errorTitle}
        description={meta.errorDescription}
        action={
          <button
            type="button"
            className="md-button md-button--primary home-section-retry"
            onClick={props.onRetry}
            disabled={props.retrying}
          >
            {meta.retryLabel}
          </button>
        }
      />
    </section>
  );
}

function QuickSearchInline() {
  return (
    <Form reloadDocument method="get" action="/search" role="search" className="home-inline-search">
      <div className="md-search-bar md-search-bar--compact">
        <span className="material-symbols-rounded" aria-hidden="true">
          search
        </span>
        <input
          className="md-search-bar__input"
          name="q"
          type="search"
          placeholder="搜索标题、作者、ID…"
          aria-label="搜索标题、作者、ID"
        />
        <button className="md-button md-button--primary md-button--icon" type="submit" aria-label="开始搜索">
          <span className="material-symbols-rounded" aria-hidden="true">
            arrow_forward
          </span>
        </button>
      </div>
    </Form>
  );
}
