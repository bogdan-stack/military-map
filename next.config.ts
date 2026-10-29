import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["milsymbol", "mil-std-2525", "mgrs"],
};

export default nextConfig;
