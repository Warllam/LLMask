import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes("--watch");
const outdir = resolve(__dirname, "dist");

mkdirSync(outdir, { recursive: true });

function copyStatics() {
  copyFileSync(
    resolve(__dirname, "src/popup.html"),
    resolve(outdir, "popup.html")
  );
  copyFileSync(
    resolve(__dirname, "src/styles.css"),
    resolve(outdir, "styles.css")
  );
  copyFileSync(
    resolve(__dirname, "manifest.json"),
    resolve(outdir, "manifest.json")
  );
}

const buildConfig = {
  bundle: true,
  platform: "browser",
  target: "chrome100",
  outdir,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
};

const entryPoints = {
  content: resolve(__dirname, "src/content.ts"),
  popup: resolve(__dirname, "src/popup.ts"),
  background: resolve(__dirname, "src/background.ts"),
};

if (isWatch) {
  const ctx = await esbuild.context({
    ...buildConfig,
    entryPoints,
    plugins: [
      {
        name: "copy-statics",
        setup(build) {
          build.onEnd(() => {
            copyStatics();
            console.log("[LLMask] Rebuilt →", outdir);
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log("[LLMask] Watching for changes… (Ctrl+C to stop)");
} else {
  await esbuild.build({
    ...buildConfig,
    entryPoints,
    minify: true,
  });
  copyStatics();
  console.log("[LLMask] Build complete →", outdir);
}
