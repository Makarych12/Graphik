import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
export async function resolve(spec, ctx, next) {
  if (spec.startsWith(".") && !/\.[a-z]+$/i.test(spec) && ctx.parentURL) {
    const url = new URL(spec, ctx.parentURL);
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const cand = new URL(url.href + ext);
      if (existsSync(fileURLToPath(cand))) return next(cand.href, ctx);
    }
  }
  return next(spec, ctx);
}
