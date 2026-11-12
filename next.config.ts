import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@armyc2.c5isr.renderer/mil-sym-ts-web", "mgrs"],
  serverExternalPackages: ["pdfjs-dist", "tesseract.js", "@napi-rs/canvas", "mammoth"],
};

export default nextConfig;
