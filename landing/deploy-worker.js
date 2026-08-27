const MACOS_DOWNLOAD_PATHS = new Set([
  "/download/mac",
  "/downloads/God-of-Sessions_0.1.0_aarch64.dmg",
]);

function downloadLocation(env) {
  try {
    const location = new URL(env.MACOS_DOWNLOAD_URL);
    if (
      location.protocol !== "https:" ||
      location.username ||
      location.password ||
      location.hash
    ) {
      return null;
    }
    return location;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (MACOS_DOWNLOAD_PATHS.has(url.pathname) && request.method === "GET") {
      const location = downloadLocation(env);
      if (!location) {
        return new Response("Download temporarily unavailable", {
          status: 503,
        });
      }
      return Response.redirect(location, 302);
    }

    return env.ASSETS.fetch(request);
  },
};
