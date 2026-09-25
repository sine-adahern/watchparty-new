/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // avoid double-mounting the realtime/WebRTC effect in dev
};

module.exports = nextConfig;
