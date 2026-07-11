import { Outlet } from "@remix-run/react";

import { AppChrome } from "../components/ui";

export default function MeLayoutRoute() {
  return (
    <AppChrome showSearch={false} subtitle="登录与设置" title="我的">
      <Outlet />
    </AppChrome>
  );
}
