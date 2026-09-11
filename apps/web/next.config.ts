import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@katan/engine"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
