import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Kodo Code (Electrobun Experimental)",
    identifier: "com.kodo.code.electrobun",
    version: "0.0.1",
  },
  build: {
    buildFolder: process.env.KODOCODE_ELECTROBUN_BUILD_FOLDER?.trim() || "build",
    copy: {
      "../web/dist/index.html": "views/mainview/index.html",
      "../web/dist/assets": "views/mainview/assets",
      "../server/dist": "runtime/server-dist",
    },
    watchIgnore: ["views/**", "../web/dist/**", "../server/dist/**"],
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
      icon: "../../assets/prod/kodo-black-windows.ico",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  scripts: {
    postBuild: "scripts/postbuild.ts",
  },
} satisfies ElectrobunConfig;
