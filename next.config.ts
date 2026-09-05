import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Справочникът на бригадата се пренесе в „Настройки“; старият адрес остава
  // работещ заради запазени отметки и иконата на инсталираното приложение.
  redirects() {
    return [{ source: "/sluzhiteli", destination: "/nastroyki", permanent: false }];
  },
};

export default nextConfig;
