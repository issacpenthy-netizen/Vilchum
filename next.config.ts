import type { NextConfig } from "next";
const config: NextConfig = { serverExternalPackages: ["sharp"], outputFileTracingRoot: process.cwd(), devIndicators: false };
export default config;
