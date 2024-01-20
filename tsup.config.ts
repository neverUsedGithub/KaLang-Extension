import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["client/extension.ts", "server/index.ts"],
    format: "cjs",
    clean: true,
    outDir: "out",
    external: ["vscode"],
    noExternal: [/^(?!vscode(?!-)).*$/],
    treeshake: true,
    minify: true,
});
