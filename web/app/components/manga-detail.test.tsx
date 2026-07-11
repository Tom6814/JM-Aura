import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import type { ReactElement } from "react";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import { DownloadChapterPicker, FavoriteFolderPicker, MangaDetailLayout } from "./manga-detail";

test("MangaDetailLayout keeps a mobile-first reading order while exposing desktop split regions", () => {
  const markup = renderToStaticMarkup(
    <MangaDetailLayout
      cover={<div>封面</div>}
      eyebrow="作品详情"
      heroBadges={<div>徽标</div>}
      heroTags={<div>标签</div>}
      heroMeta={<div>元信息</div>}
      heroActions={<div>操作</div>}
      heroSupport={<div>辅助信息</div>}
      status={<div>状态</div>}
      tabs={<div>标签页</div>}
      main={<section>主内容</section>}
      aside={<aside>侧边摘要</aside>}
      title="测试漫画"
      description="详情页布局测试"
    />,
  );

  assert.match(markup, /class="manga-detail-layout"/);
  assert.match(markup, /class="manga-detail-layout__hero-shell"/);
  assert.match(markup, /class="manga-detail-layout__hero"/);
  assert.match(markup, /class="manga-detail-layout__hero-surface"/);
  assert.match(markup, /class="manga-detail-layout__hero-main"/);
  assert.match(markup, /class="manga-detail-layout__hero-header"/);
  assert.match(markup, /class="manga-detail-layout__hero-tags"/);
  assert.match(markup, /class="manga-detail-layout__hero-facts"/);
  assert.match(markup, /class="manga-detail-layout__hero-side"/);
  assert.match(markup, /class="manga-detail-layout__hero-support"/);
  assert.match(markup, /class="manga-detail-layout__content"/);
  assert.match(markup, /class="manga-detail-layout__main"/);
  assert.match(markup, /class="manga-detail-layout__aside"/);
  assert.match(markup, /作品详情/);
  assert.match(markup, /详情页布局测试/);
  assert.match(markup, /辅助信息/);

  assert.ok(markup.indexOf("manga-detail-layout__main") < markup.indexOf("manga-detail-layout__aside"));
  assert.ok(markup.indexOf("manga-detail-layout__tabs") < markup.indexOf("manga-detail-layout__content"));
});

test("MangaDetailLayout omits optional status region when it is not provided", () => {
  const markup = renderToStaticMarkup(
    <MangaDetailLayout
      cover={<div>封面</div>}
      eyebrow="作品详情"
      heroBadges={<div>徽标</div>}
      heroTags={<div>标签</div>}
      heroMeta={<div>元信息</div>}
      heroActions={<div>操作</div>}
      tabs={<div>标签页</div>}
      main={<section>主内容</section>}
      aside={<aside>侧边摘要</aside>}
      title="测试漫画"
      description="无状态栏"
    />,
  );

  assert.doesNotMatch(markup, /manga-detail-layout__status/);
  assert.doesNotMatch(markup, /manga-detail-layout__hero-side/);
  assert.match(markup, /class="manga-detail-layout__tabs"/);
});

test("FavoriteFolderPicker renders a single shared picker shell for desktop modal and mobile drawer styling", () => {
  return withRouterMarkup(
    <FavoriteFolderPicker
      open
      loading={false}
      pending={false}
      folders={[
        { FID: "0", name: "默认收藏夹" },
        { FID: "42", name: "待补档" },
      ]}
      selectedFolderId="42"
      onClose={() => {}}
    />,
  ).then((markup) => {
    assert.match(markup, /filter-drawer filter-drawer--open manga-favorite-picker/);
    assert.match(markup, /收藏到哪个收藏夹/);
    assert.match(markup, /value="42"/);
    assert.match(markup, /待补档/);
    assert.match(markup, /确认收藏/);
  });
});

test("DownloadChapterPicker renders chapter selection controls for shared desktop/mobile shell", () => {
  return withRouterMarkup(
    <DownloadChapterPicker
      open
      pending={false}
      episodes={[
        { photo_id: "c1", sort: "1", name: "第一话" },
        { photo_id: "c2", sort: "2", name: "第二话" },
      ]}
      selectedChapterIds={["c2"]}
      onToggleChapter={() => {}}
      onSelectAll={() => {}}
      onClear={() => {}}
      onClose={() => {}}
    />,
  ).then((markup) => {
    assert.match(markup, /filter-drawer filter-drawer--open manga-download-picker/);
    assert.match(markup, /选择要下载的章节/);
    assert.match(markup, /全选/);
    assert.match(markup, /清空/);
    assert.match(markup, /value="c2"/);
    assert.match(markup, /确认下载/);
  });
});

async function withRouterMarkup(element: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element }], { initialEntries: ["/"] });

  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });

    const stream = renderToPipeableStream(<RouterProvider router={router} />, {
      onAllReady() {
        stream.pipe(writable);
      },
      onError(error) {
        reject(error);
      },
    });

    writable.on("finish", () => resolve(Buffer.concat(chunks).toString("utf8")));
    writable.on("error", reject);
  });
}
