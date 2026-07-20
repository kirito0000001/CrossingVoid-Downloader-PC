import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createReadStream, existsSync, type Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import packageJson from "./package.json";

const characterRoot = resolve(__dirname, "OnSet", "Character");
const noticeBoardRoot = resolve(__dirname, "OnSet", "NoticeBoard");
const videoRoot = resolve(__dirname, "OnSet", "Video");
const colorConfigPath = resolve(__dirname, "OnSet", "Color.json");
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const videoExtensions = new Set([".mp4", ".webm", ".ogg"]);
const imageContentTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);
const videoContentTypes = new Map([
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".ogg", "video/ogg"],
]);

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function normalizeCharacterText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function normalizeCharacterTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 4);
}

function findCharacterImage(files: Dirent[], preferredImage: unknown) {
  const images = files.filter((item) => item.isFile() && imageExtensions.has(extname(item.name).toLowerCase()));
  const requestedName = typeof preferredImage === "string"
    ? preferredImage.replace(/\\/g, "/").split("/").pop()?.trim()
    : "";
  if (requestedName) {
    const requested = images.find((item) => item.name.localeCompare(requestedName, undefined, { sensitivity: "accent" }) === 0);
    if (requested) return requested;
  }

  const priority = (name: string) => {
    const stem = name.slice(0, -extname(name).length).toLowerCase();
    if (stem === "banner") return 0;
    if (stem === "cover") return 1;
    if (stem === "character") return 2;
    return 3;
  };
  return images.sort((left, right) => priority(left.name) - priority(right.name) || left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true }))[0];
}

async function onSetAssetUrl(parts: string[], filePath: string) {
  const info = await stat(filePath);
  const encodedPath = parts.map((part) => encodeURIComponent(part)).join("/");
  return `/OnSet/${encodedPath}?v=${Math.trunc(info.mtimeMs)}-${info.size}`;
}

async function readOnSetCharacters(includeBuildPaths = false) {
  if (!existsSync(characterRoot)) return [];
  const folders = (await readdir(characterRoot, { withFileTypes: true }))
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
  const characters = [];

  for (const folder of folders) {
    const folderPath = join(characterRoot, folder);
    try {
      const files = await readdir(folderPath, { withFileTypes: true });
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(await readFile(join(folderPath, "character.json"), "utf-8"));
      } catch (error) {
        console.warn(`[OnSet] ${folder}/character.json could not be read; using folder defaults.`, error);
      }

      const image = findCharacterImage(files, meta.banner ?? meta.image);
      const imagePath = image ? join(folderPath, image.name) : "";
      const entry: Record<string, unknown> = {
        folder,
        name: normalizeCharacterText(meta.name, folder),
        work: normalizeCharacterText(meta.work, "待填写作品名称"),
        tags: normalizeCharacterTags(meta.tags),
        banner: image ? await onSetAssetUrl(["Character", folder, image.name], imagePath) : "",
      };
      if (includeBuildPaths && image) {
        entry.imagePath = imagePath;
        entry.imageFileName = `OnSet/Character/${folder}/${image.name}`;
      }
      characters.push(entry);
    } catch (error) {
      console.warn(`[OnSet] Character folder ${folder} could not be loaded.`, error);
      characters.push({
        folder,
        name: folder,
        work: "待填写作品名称",
        tags: [],
        banner: "",
      });
    }
  }

  return characters;
}

function onsetCharacterPlugin() {
  return {
    name: "crossing-void-onset-characters",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__cv_onset_characters")) {
          next();
          return;
        }

        try {
          const characters = await readOnSetCharacters();

          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify({ characters }));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

function onsetNoticeBoardPlugin() {
  return {
    name: "crossing-void-onset-notice-board",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__cv_onset_notice_board")) {
          next();
          return;
        }

        try {
          if (!existsSync(noticeBoardRoot)) {
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ notice: null }));
            return;
          }

          const files = await readdir(noticeBoardRoot, { withFileTypes: true });
          const image = files.find((item) => item.isFile() && imageExtensions.has(extname(item.name).toLowerCase()));
          const raw = await readFile(join(noticeBoardRoot, "notice.json"), "utf-8");
          const meta = JSON.parse(raw);

          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(
            JSON.stringify({
              notice: {
                title: String(meta.title ?? "更新公告"),
                subtitle: String(meta.subtitle ?? ""),
                banner: image ? `OnSet/NoticeBoard/${image.name}` : "",
                sections: Array.isArray(meta.sections) ? meta.sections : [],
              },
            }),
          );
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

function onsetVideoPlugin() {
  return {
    name: "crossing-void-onset-video",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__cv_onset_videos")) {
          next();
          return;
        }

        try {
          if (!existsSync(videoRoot)) {
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ videos: [] }));
            return;
          }

          const files = (await readdir(videoRoot, { withFileTypes: true }))
            .filter((item) => item.isFile() && extname(item.name).toLowerCase() === ".json")
            .map((item) => item.name)
            .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
          const videos = await Promise.all(
            files.map(async (file) => {
              const raw = await readFile(join(videoRoot, file), "utf-8");
              const meta = JSON.parse(raw);
              const video = String(meta.video ?? "");
              const isLocalVideo = video && !/^https?:\/\//i.test(video);

              return {
                title: String(meta.title ?? file.replace(/\.json$/i, "")),
                date: String(meta.date ?? ""),
                video: isLocalVideo ? `OnSet/Video/${video}` : video,
              };
            }),
          );

          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ videos }));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

function onsetColorPlugin() {
  return {
    name: "crossing-void-onset-colors",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__cv_onset_colors")) {
          next();
          return;
        }

        try {
          if (!existsSync(colorConfigPath)) {
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ colors: null }));
            return;
          }

          const raw = await readFile(colorConfigPath, "utf-8");
          const colors = JSON.parse(raw);

          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ colors }));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

function onsetStaticAssetsPlugin() {
  return {
    name: "crossing-void-onset-static-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/OnSet/")) {
          next();
          return;
        }

        const urlPath = decodeURIComponent(request.url.split("?")[0] ?? "");
        const relativePath = urlPath.replace(/^\/OnSet\//, "");
        const absolutePath = resolve(__dirname, "OnSet", relativePath);
        const onsetRoot = resolve(__dirname, "OnSet");
        const extension = extname(absolutePath).toLowerCase();

        const isAllowedAsset = imageExtensions.has(extension) || videoExtensions.has(extension);

        if (!absolutePath.startsWith(onsetRoot) || !isAllowedAsset || !existsSync(absolutePath)) {
          response.statusCode = 404;
          response.end();
          return;
        }

        response.setHeader(
          "Content-Type",
          imageContentTypes.get(extension) ?? videoContentTypes.get(extension) ?? "application/octet-stream",
        );
        createReadStream(absolutePath).pipe(response);
      });
    },
  };
}

async function readOnSetManifest() {
  const characters = await readOnSetCharacters(true);

  let notice = null;
  if (existsSync(noticeBoardRoot)) {
    const files = await readdir(noticeBoardRoot, { withFileTypes: true });
    const image = files.find((item) => item.isFile() && imageExtensions.has(extname(item.name).toLowerCase()));
    const raw = await readFile(join(noticeBoardRoot, "notice.json"), "utf-8");
    const meta = JSON.parse(raw);
    notice = {
      title: String(meta.title ?? "更新公告"),
      subtitle: String(meta.subtitle ?? ""),
      banner: image ? `OnSet/NoticeBoard/${image.name}` : "",
      imagePath: image ? join(noticeBoardRoot, image.name) : "",
      imageFileName: image ? `OnSet/NoticeBoard/${image.name}` : "",
      sections: Array.isArray(meta.sections) ? meta.sections : [],
    };
  }

  const videos = [];
  if (existsSync(videoRoot)) {
    const files = (await readdir(videoRoot, { withFileTypes: true }))
      .filter((item) => item.isFile() && extname(item.name).toLowerCase() === ".json")
      .map((item) => item.name)
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));

    for (const file of files) {
      const raw = await readFile(join(videoRoot, file), "utf-8");
      const meta = JSON.parse(raw);
      const video = String(meta.video ?? "");
      const isLocalVideo = video && !/^https?:\/\//i.test(video);
      videos.push({
        title: String(meta.title ?? file.replace(/\.json$/i, "")),
        date: String(meta.date ?? ""),
        video: isLocalVideo ? `OnSet/Video/${video}` : video,
        videoPath: isLocalVideo ? join(videoRoot, video) : "",
        videoFileName: isLocalVideo ? `OnSet/Video/${video}` : "",
      });
    }
  }

  const colors = existsSync(colorConfigPath)
    ? JSON.parse(await readFile(colorConfigPath, "utf-8"))
    : null;

  return { colors, characters, notice, videos };
}

function onsetBundlePlugin() {
  return {
    name: "crossing-void-onset-bundle",
    apply: "build",
    async generateBundle() {
      const manifest = await readOnSetManifest();
      for (const character of manifest.characters) {
        if (character.imagePath && character.imageFileName) {
          this.emitFile({
            type: "asset",
            fileName: character.imageFileName,
            source: await readFile(character.imagePath),
          });
        }
        delete character.imagePath;
        delete character.imageFileName;
      }

      if (manifest.notice?.imagePath && manifest.notice.imageFileName) {
        this.emitFile({
          type: "asset",
          fileName: manifest.notice.imageFileName,
          source: await readFile(manifest.notice.imagePath),
        });
      }
      if (manifest.notice) {
        delete manifest.notice.imagePath;
        delete manifest.notice.imageFileName;
      }

      for (const video of manifest.videos) {
        if (video.videoPath && video.videoFileName) {
          this.emitFile({
            type: "asset",
            fileName: video.videoFileName,
            source: await readFile(video.videoPath),
          });
        }
        delete video.videoPath;
        delete video.videoFileName;
      }

      this.emitFile({
        type: "asset",
        fileName: "OnSet/onset-manifest.json",
        source: JSON.stringify(manifest),
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    vue(),
    onsetCharacterPlugin(),
    onsetNoticeBoardPlugin(),
    onsetVideoPlugin(),
    onsetColorPlugin(),
    onsetStaticAssetsPlugin(),
    onsetBundlePlugin(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.CV_LAUNCHER_VERSION?.trim() || packageJson.version),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Generated binaries can be locked while packaging. Watching them makes
      // Vite exit with EBUSY and leaves the Tauri window on a stale page.
      ignored: [
        "**/src-tauri/**",
        "**/dist/**",
        "**/dist-ssr/**",
        "**/dist-launcher-update/**",
        "**/dist-launcher-update-debug/**",
        "**/Logs/**",
        "**/Saved/**",
      ],
    },
  },
}));
