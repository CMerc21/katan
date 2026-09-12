import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@katan/engine", "@katan/bots", "@katan/avatars"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
