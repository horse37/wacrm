#!/usr/bin/env node
import fs from "node:fs";
const exists = (p) => fs.existsSync(p);
const pkg = exists("package.json");
const next = pkg && (exists("next.config.js") || exists("next.config.mjs") || exists("next.config.ts") || exists("app") || exists("pages") || exists("src/app"));
const n8n = exists("n8n") || exists("workflows") || exists("n8n-workflows");
const android = exists("settings.gradle") || exists("settings.gradle.kts") || exists("app/src/main/AndroidManifest.xml");
const stacks = [];
if (next || pkg) stacks.push("web");
if (n8n) stacks.push("n8n");
if (android) stacks.push("android");
console.log(JSON.stringify({ stacks }, null, 2));
