import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained server in .next/standalone for a tiny Docker image.
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    // typedRoutes: true,
  },
};

export default withSerwist(nextConfig);
