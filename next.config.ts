import type { NextConfig } from "next";

/**
 * Отпечатък на сборката. Влиза в адреса, с който се регистрира service
 * worker-ът: при нов деплой адресът е друг, браузърът вижда друг скрипт и
 * инсталира нов worker, който изтрива стария кеш. Без това `sw.js` е байт по
 * байт същият при всеки деплой, браузърът не го обновява и потребителят може
 * да остане на стария код.
 */
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
  process.env.GIT_HASH?.slice(0, 12) ??
  Date.now().toString(36);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // Справочникът на бригадата се пренесе в „Настройки“; старият адрес остава
  // работещ заради запазени отметки и иконата на инсталираното приложение.
  redirects() {
    return [{ source: "/sluzhiteli", destination: "/nastroyki", permanent: false }];
  },
};

export default nextConfig;
